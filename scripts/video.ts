#!/usr/bin/env node
// A video for the media domain, made on a computer: what the assets page (/admin) makes in the
// browser, for a video the browser can't convert (no H.264 encoder there, or a codec it can't
// decode), and for remaking videos already up. ffmpeg encodes each size ladder() names
// (site-worker/src/ladder.ts: H.264 High, yuv420p, key frames every 2 seconds, at most 30 fps,
// AAC, no metadata, index first), and ladder.ts's hlsFiles() makes the HLS set from them, so
// the files are the assets page's:
//
//   NAME.mp4, NAME.m3u8, NAME.hls/<h>.m3u8 and NAME.hls/<h>.mp4 for each size
//
// written into build/video/ (git ignores it). --upload puts them in R2 (the bucket
// adamschaefers-media, served at media.adamschaefers.com) with wrangler, the HLS files first
// and NAME.mp4 last; a taken name is refused unless --replace, which also clears the old
// copies from Cloudflare's edge. The poster (NAME.jpg) isn't made here: the assets page's
// Poster button picks one.
//
//   node scripts/video.ts <input file or URL> <name.mp4> [--upload [--replace]]
//
// --upload needs CLOUDFLARE_API_TOKEN with R2 write and cache purge on the zone (the account
// token, ../merecatholicity.com's ci.env CLOUDFLARE_ROOT_TOKEN), and ffmpeg and ffprobe on PATH.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FilePathSource } from 'mediabunny';
import { AUDIO_BITRATE, AUDIO_COPY_MAX, KEY_FRAME_INTERVAL, MAX_FPS, hlsFiles, ladder, streamNames } from '../site-worker/src/ladder.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const BUCKET = 'adamschaefers-media';
const MEDIA = 'https://media.adamschaefers.com';
const ACCOUNT = '6093bc0889c95a08f0a92a8df6750c66';
const ZONE = '8c24a36f8948b4e42d61ae9f69e6c434';
// The assets page's rule (site-worker/src/admin.ts NAME), ending .mp4.
const NAME = /^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.mp4$/;
const CACHE_CONTROL = 'public, max-age=3600';
const TYPES: Record<string, string> = { mp4: 'video/mp4', m3u8: 'application/vnd.apple.mpegurl' };

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [input, name] = args.filter((a) => !a.startsWith('--'));
if (!input || !name || [...flags].some((f) => f !== '--upload' && f !== '--replace')) {
  console.error('usage: node scripts/video.ts <input file or URL> <name.mp4> [--upload [--replace]]');
  process.exit(64);
}
if (!NAME.test(name)) {
  console.error(`video: name it like the assets page does: lowercase letters, digits, dots, dashes and underscores, folders allowed, ending .mp4 (${name})`);
  process.exit(64);
}
const token = process.env.CLOUDFLARE_API_TOKEN;
if (flags.has('--upload') && !token) {
  console.error('video: --upload needs CLOUDFLARE_API_TOKEN (R2 write and cache purge)');
  process.exit(64);
}

// The input as displayed: a phone's portrait video is stored landscape with a rotation.
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
  'stream=width,height,avg_frame_rate:stream_side_data=rotation', '-of', 'json', input], { encoding: 'utf8' }));
const stream = probe.streams?.[0];
if (!stream) throw new Error(`video: ${input} has no video`);
const turned = Math.abs(Number(stream.side_data_list?.find((d: { rotation?: number }) => 'rotation' in d)?.rotation ?? 0)) % 180 === 90;
const [width, height] = turned ? [stream.height, stream.width] : [stream.width, stream.height];
// Over MAX_FPS, it is brought down to it; otherwise each frame keeps its own time. A phone's
// video often runs at a varying rate (29.98 on average): made constant, frames would be
// doubled here and there.
const [num, den] = String(stream.avg_frame_rate).split('/').map(Number);
const fast = den > 0 && num / den > MAX_FPS + 0.5;
const [audio, audioBitrate] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,bit_rate',
  '-of', 'csv=p=0', input], { encoding: 'utf8' }).trim().split(',');
const copyAudio = audio === 'aac' && Number(audioBitrate) <= AUDIO_COPY_MAX;
const rungs = ladder(width, height);
const out = join(ROOT, 'build/video', name.replace(/\.mp4$/, ''));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
console.log(`video: ${input}, ${width}x${height}${audio ? `, ${audio} sound` : ', no sound'}: ${rungs.map((r) => `${r.width}x${r.height} at ${r.bitrate / 1000} kbps`).join(', ')}`);

// Each size: H.264 at a quality (CRF), held under the size's bitrate, a key frame every 2
// seconds and nowhere else, so every size's segments start at the same moments.
const sizes = rungs.map((rung) => {
  const file = join(out, `${rung.short}p.mp4`);
  const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1',
    '-vf', `scale=${rung.width}:${rung.height}:flags=lanczos:out_range=limited,format=yuv420p`,
    ...(fast ? ['-fpsmax', String(MAX_FPS)] : ['-fps_mode', 'passthrough']),
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '23',
    '-maxrate', String(rung.bitrate), '-bufsize', String(2 * rung.bitrate),
    '-force_key_frames', `expr:gte(t,n_forced*${KEY_FRAME_INTERVAL})`, '-g', '9999', '-keyint_min', '9999', '-sc_threshold', '0',
    '-color_range', 'tv',
    ...(copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', String(AUDIO_BITRATE)]),
    '-movflags', '+faststart', file], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`video: ffmpeg failed making ${rung.short}p`);
  console.log(`video: ${rung.short}p made`);
  return { rung, file };
});

const files = await hlsFiles(name, sizes.map(({ rung, file }) => ({ rung, source: new FilePathSource(file) })));
const { mp4, master } = streamNames(name);
const local = new Map<string, string>(); // address on the media domain -> file here
for (const [path, bytes] of files) {
  const file = join(out, 'media', path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  local.set(path, file);
}
const top = join(out, 'media', mp4);
mkdirSync(dirname(top), { recursive: true });
copyFileSync(sizes[0].file, top);
local.set(mp4, top);
console.log(`video: ${[...local.keys()].join(', ')} in ${join(out, 'media')}`);

if (flags.has('--upload')) {
  // The HLS files before the master playlist that names them, and the MP4 pages name, last.
  const order = [...local.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  function rank(path: string) {
    return path === mp4 ? 3 : path === master ? 2 : path.endsWith('.m3u8') ? 1 : 0;
  }
  const taken = [];
  for (const path of order) {
    if ((await fetch(`${MEDIA}/${path}`, { method: 'HEAD' })).status === 200) taken.push(path);
  }
  if (taken.length && !flags.has('--replace')) {
    console.error(`video: taken: ${taken.join(', ')}. Use another name (browsers may hold the old files for an hour), or --replace.`);
    process.exit(1);
  }
  for (const path of order) {
    const type = TYPES[path.slice(path.lastIndexOf('.') + 1)];
    const put = spawnSync(join(ROOT, 'node_modules/.bin/wrangler'), ['r2', 'object', 'put', `${BUCKET}/${path}`,
      '--file', local.get(path)!, '--content-type', type, '--cache-control', CACHE_CONTROL, '--remote'],
      { cwd: ROOT, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    if (put.status !== 0) throw new Error(`video: uploading ${path} failed:\n${put.stdout}${put.stderr}`);
    console.log(`video: uploaded ${MEDIA}/${path}`);
  }
  if (taken.length) {
    // Cloudflare's purge takes up to 30 addresses a request.
    for (let i = 0; i < taken.length; i += 30) {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}/purge_cache`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: taken.slice(i, i + 30).map((path) => `${MEDIA}/${path}`) }),
      });
      const body = await r.json() as { success?: boolean; errors?: unknown };
      if (!body.success) console.error(`video: the old copies couldn't be cleared from Cloudflare's edge (${JSON.stringify(body.errors)}); they lapse within the hour`);
    }
    console.log(`video: replaced ${taken.length} file(s), cleared from Cloudflare's edge`);
  }
}
