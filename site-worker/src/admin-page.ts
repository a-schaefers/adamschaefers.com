/* The assets page's script (src/admin.ts serves the page): the list, filtered by name; an
   upload, with its progress; copying an asset's Org line or address; deleting one. A video is
   made in the browser before it goes up (convert, below), so an iPhone's .mov can be uploaded
   straight from the phone: an MP4 in each size the site streams it at, and its HLS files from
   those (ladder.ts), all of which go up, with its poster (pickPoster, below). Browser code:
   scripts/build.ts bundles it (Mediabunny and ladder.ts too) into src/admin-page.gen.ts, which
   the page inlines. Its classes are Tailwind's (src/admin-page.css). */

import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality, canEncodeVideo } from 'mediabunny';
import { AUDIO_BITRATE, AUDIO_COPY_MAX, KEY_FRAME_INTERVAL, MAX_FPS, hlsFiles, ladder, streamNames, type Rung } from './ladder.ts';

interface Item { name: string; url: string; size: number; uploaded: string; type: string }

// The classes of what this draws: a thumbnail, an asset's name, a row's buttons.
const THUMB = 'block h-[54px] w-24 rounded-md bg-ridge object-cover';
const PATH = 'font-mono text-[13px] leading-[1.4] break-all';
const ACTIONS = 'flex flex-wrap gap-[.35rem]';
const SMALL = 'px-[.55rem] py-1 text-[.85rem]';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' } as Record<string, string>)[c]);
let items: Item[] = [];
function say(text: string, bad?: boolean) { $('#msg').textContent = text; $('#msg').classList.toggle('err', Boolean(bad)); }
const size = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
// How an Org page names it: a travelog's video, an inline picture, a link to anything else.
function org(item: Pick<Item, 'name' | 'url' | 'type'>) {
  if (item.type.startsWith('video/')) return '#+VIDEO: ' + item.url;
  if (item.type.startsWith('image/')) return '[[' + item.url + ']]';
  return '[[' + item.url + '][' + item.name + ']]';
}
// A video's HLS files (NAME.m3u8, NAME.hls/...) aren't listed apart: its row says the sizes
// it streams in, and deleting it deletes them (src/admin.ts).
const isPart = (name: string) => name.includes('.hls/') || (name.endsWith('.m3u8') && items.some((i) => i.name === name.replace(/\.m3u8$/, '.mp4')));
function sizesOf(item: Item) {
  const { folder } = streamNames(item.name);
  return items.filter((i) => i.name.startsWith(folder) && i.name.endsWith('.m3u8'))
    .map((i) => Number(i.name.slice(folder.length, -'.m3u8'.length))).sort((a, b) => b - a);
}
function thumb(item: Item) {
  const src = item.url;
  if (item.type.startsWith('image/')) return '<img class="' + THUMB + '" loading="lazy" alt="" src="' + esc(src) + '">';
  if (item.type.startsWith('video/')) return '<video class="' + THUMB + '" muted preload="metadata" src="' + esc(src) + '#t=1"></video>';
  return '<span class="' + THUMB + '"></span>';
}
function render() {
  const q = $<HTMLInputElement>('#q').value.trim().toLowerCase();
  const shown = items.filter((i) => !isPart(i.name) && (!q || i.name.toLowerCase().includes(q)));
  const streams = (i: Item) => {
    const sizes = i.type.startsWith('video/') ? sizesOf(i) : [];
    return sizes.length ? ' · streams in ' + sizes.map((h) => h + 'p').join(', ') : i.type.startsWith('video/') ? ' · no streaming sizes: upload it again' : '';
  };
  $('#rows').innerHTML = shown.map((i, n) => '<tr><td>' + thumb(i) + '</td><td><span class="' + PATH + '">' + esc(i.name) + '</span><small>' + esc(i.type) + esc(streams(i)) + '</small></td><td>' + size(i.size) +
    '</td><td>' + esc(new Date(i.uploaded).toLocaleString()) + '</td><td class="' + ACTIONS + '">' +
    '<button class="' + SMALL + '" data-n="' + n + '" data-do="org">Copy Org</button><button class="' + SMALL + '" data-n="' + n + '" data-do="url">Copy address</button>' +
    (i.type.startsWith('video/') ? '<button class="' + SMALL + '" data-n="' + n + '" data-do="poster">Poster</button>' : '') +
    '<a href="' + esc(i.url) + '" target="_blank" rel="noopener"><button class="' + SMALL + '" type="button">Open</button></a><button class="' + SMALL + '" data-n="' + n + '" data-do="delete">Delete</button></td></tr>').join('') ||
    '<tr><td colspan="5"><small>' + (items.length ? 'Nothing matches.' : 'No assets yet.') + '</small></td></tr>';
  $('#rows').dataset.shown = JSON.stringify(shown.map((i) => items.indexOf(i)));
}
async function load() {
  const r = await fetch('/admin/api/media');
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return say(data.error || 'Could not list the assets (' + r.status + ')', true);
  items = data.items;
  render();
}
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); say('Copied: ' + text); } catch { prompt('Copy:', text); }
}
$('#rows').addEventListener('click', async (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-do]');
  if (!b) return;
  const item = items[JSON.parse($('#rows').dataset.shown!)[b.dataset.n!]];
  if (b.dataset.do === 'org') return copy(org(item));
  if (b.dataset.do === 'url') return copy(item.url);
  if (b.dataset.do === 'poster') {
    const still = await pickPoster('/admin/api/media/' + encodeURI(item.name));
    if (!still) return;
    const name = posterName(item.name);
    say('Uploading ' + name + '…');
    const { status, data } = await put(name, still, true, () => {});
    if (status !== 200) return say(data.error || 'Upload failed (' + (status || 'network') + ')', true);
    say('Its poster is ' + data.url + '.' + (data.purged === false ? ' Cloudflare may serve the old one for up to an hour (its cache could not be cleared).'
      : data.purged ? ' The old one is cleared from Cloudflare\'s cache; a browser that has it may keep it up to an hour.' : ''), data.purged === false);
    return load();
  }
  if (b.dataset.do === 'delete') {
    const video = item.type.startsWith('video/');
    if (!confirm('Delete ' + item.name + (video ? ' and its streaming sizes' : '') + '? Pages that name it will lose it, and make check fails until they stop.')) return;
    const r = await fetch('/admin/api/media/' + encodeURI(item.name), { method: 'DELETE' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return say(data.error || 'Delete failed (' + r.status + ')', true);
    const also = (data.deleted?.length ?? 1) - 1;
    say('Deleted ' + item.name + (also ? ' and its ' + also + ' streaming file' + (also > 1 ? 's' : '') : '') +
      (data.purged ? ', and cleared from Cloudflare\'s cache.' : '. Cloudflare may serve it for up to an hour (its cache could not be cleared).'), !data.purged);
    load();
  }
});
$('#q').addEventListener('input', render);
const LIMIT = 100 * 1048576; // the Worker's request limit: one upload
const isVideo = (f: File) => f.type.startsWith('video/') || /\.(mov|mp4|m4v|hevc)$/i.test(f.name);

// The two steps' bars: the conversion's, then the upload's, each with its percentage.
function step(which: 'convert' | 'upload', value: number) {
  $('#' + which).hidden = false;
  $<HTMLProgressElement>('#' + which + ' progress').value = value;
  $('#' + which + ' output').textContent = Math.floor(value * 100) + '%';
}
function hideSteps() {
  for (const which of ['convert', 'upload'] as const) {
    step(which, 0);
    $('#' + which).hidden = true;
  }
}

/** F as the site streams videos (ladder.ts): an MP4 of H.264 and AAC in each size ladder()
    names, largest first, each with its index first (faststart), a key frame every 2 seconds,
    at most 30 frames a second and none of the file's metadata (an iPhone's holds where it was
    shot); then the HLS files (NAME.m3u8 and NAME.hls/...) made from them. The largest is
    NAME.mp4. Done in this browser, on its own video hardware (WebCodecs, by Mediabunny); the
    sound is copied as it is when it's AAC no heavier than a phone's. */
async function convert(f: File, name: string) {
  const computer = 'Convert it on a computer: node scripts/video.ts (CLAUDE.md).';
  if (!(await canEncodeVideo('avc'))) throw new Error('This browser can\'t encode H.264 video. ' + computer);
  let rungs: Rung[], fps: number, sound: 'encode' | 'copy' | 'none';
  const probe = new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
  try {
    const video = await probe.getPrimaryVideoTrack();
    if (!video) throw new Error('There is no video in this file.');
    rungs = ladder(video.displayWidth, video.displayHeight);
    fps = (await video.computePacketStats(120)).averagePacketRate;
    const audio = await probe.getPrimaryAudioTrack();
    sound = !audio ? 'none' : audio.codec === 'aac' && (await audio.computePacketStats(200)).averageBitrate <= AUDIO_COPY_MAX ? 'copy' : 'encode';
  } finally {
    probe.dispose();
  }
  const hadSound = sound !== 'none';
  // If this browser can't encode the sound after all (it may say it can and fail), the sound
  // is copied as it is when it's AAC, and left out when it isn't.
  const fallbacks = { encode: 'copy', copy: 'none', none: null } as const;
  const isAac = async () => {
    const input = new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
    try { return (await input.getPrimaryAudioTrack())?.codec === 'aac'; } finally { input.dispose(); }
  };
  // Each size's share of the conversion's bar: its pixels.
  const weights = rungs.map((r) => r.width * r.height), all = weights.reduce((a, b) => a + b);
  let done = 0, lost: string[] = [];
  const sizes: { rung: Rung; blob: Blob }[] = [];
  for (const [i, rung] of rungs.entries()) {
    for (;;) {
      const target = new BufferTarget();
      const conversion = await Conversion.init({
        input: new Input({ source: new BlobSource(f), formats: ALL_FORMATS }),
        output: new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target }),
        tracks: 'primary',
        tags: {},
        video: {
          codec: 'avc', width: rung.width, height: rung.height, fit: 'fill',
          quality: new Quality({ bitrate: rung.bitrate, bitrateMode: 'variable' }),
          keyFrameInterval: KEY_FRAME_INTERVAL, forceTranscode: true,
          // The frames themselves upright, not a rotation for the player to apply.
          allowTransformationMetadata: false,
          ...(fps > MAX_FPS + 0.5 && { frameRate: MAX_FPS }),
        },
        audio: sound === 'none' ? { discard: true } : sound === 'copy' ? { codec: 'aac' }
          : { codec: 'aac', quality: new Quality({ bitrate: AUDIO_BITRATE }), forceTranscode: true },
        showWarnings: false,
      });
      lost = conversion.discardedTracks.filter((d) => d.reason !== 'discarded_by_user').map((d) => d.track.type + ' (' + d.reason.replaceAll('_', ' ') + ')');
      if (hadSound && sound === 'none') lost.push('audio (not encodable here)');
      if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.type === 'video')) throw new Error('This video can\'t be converted here: ' + (lost.join(', ') || 'no video in it') + '. ' + computer);
      conversion.onProgress = (p) => step('convert', (done + p * weights[i]) / all * .95);
      try {
        await conversion.execute();
      } catch (err) {
        let next = fallbacks[sound];
        if (next === 'copy' && !(await isAac())) next = 'none';
        if (i > 0 || !next) throw err;
        sound = next;
        continue;
      }
      sizes.push({ rung, blob: new Blob([target.buffer!], { type: 'video/mp4' }) });
      break;
    }
    done += weights[i];
  }
  const hls = await hlsFiles(name, sizes.map(({ rung, blob }) => ({ rung, source: new BlobSource(blob) })));
  step('convert', 1);
  return { blob: sizes[0].blob, hls, lost: [...new Set(lost.filter((t) => t.startsWith('audio')))] };
}

/** A poster for the video at SRC (this origin's, so its frames can be read): the frame the
    owner picks, playing or dragging to it, from a quarter of the way in (the first second is
    often a transition). A JPEG, or undefined for none. The site finds a post's video's poster
    by the video's address ending .jpg (#+FEATURED). */
function pickPoster(src: string) {
  const dialog = $<HTMLDialogElement>('#pick'), video = $<HTMLVideoElement>('#pick-video');
  video.onloadedmetadata = () => { video.currentTime = video.duration / 4; };
  video.src = src;
  dialog.showModal();
  return new Promise<Blob | undefined>((done) => {
    const finish = (still?: Blob) => {
      video.pause();
      dialog.close();
      video.removeAttribute('src');
      video.load();
      done(still);
    };
    $('#pick-skip').onclick = () => finish();
    dialog.oncancel = (e) => { e.preventDefault(); finish(); };
    $('#pick-use').onclick = () => {
      if (!video.videoWidth) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      canvas.toBlob((still) => finish(still ?? undefined), 'image/jpeg', .85);
    };
  });
}
const posterName = (name: string) => name.replace(/\.[a-z0-9]+$/, '') + '.jpg';

interface Uploaded { error?: string; name?: string; size?: number; url?: string; type?: string; purged?: boolean }
/** Upload BODY as NAME (replacing a taken one if REPLACE), reporting the bytes sent. */
function put(name: string, body: Blob, replace: boolean, sent: (bytes: number) => void) {
  return new Promise<{ status: number; data: Uploaded }>((done) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/admin/api/media/' + encodeURI(name) + (replace ? '?replace=1' : ''));
    xhr.setRequestHeader('Content-Type', body.type || 'application/octet-stream');
    xhr.upload.onprogress = (p) => sent(p.loaded);
    xhr.onloadend = () => {
      let data: Uploaded = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      done({ status: xhr.status, data });
    };
    xhr.send(body);
  });
}

// A name an Org link can carry: lowercase, dashes for spaces and oddities; a video's ends in .mp4.
$('#file').addEventListener('change', () => {
  const f = $<HTMLInputElement>('#file').files![0];
  if (!f) return;
  const name = f.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  $<HTMLInputElement>('#name').value = isVideo(f) ? name.replace(/\.[a-z0-9]+$/, '') + '.mp4' : name;
  $('#note').innerHTML = isVideo(f) ? 'A video: made on this device first, in each size the site streams it at (720p, 480p and 360p at most; H.264, no location or other metadata), then uploaded with its streaming files and a JPEG poster of the same name, from the frame you pick. Keep this page open until it\'s done.'
    : f.size > LIMIT ? '<span class="text-chile">Over 100 MB: too big for one upload. Make it smaller.</span>'
    : 'Up to 100 MB. Videos are made here, in each size the site streams them at, before they go up, with a poster.';
});
$('#up').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = $<HTMLInputElement>('#file').files![0];
  const name = $<HTMLInputElement>('#name').value.trim();
  if (!f || !name) return;
  const replace = $<HTMLInputElement>('#replace').checked;
  const video = isVideo(f);
  const taken = items.some((i) => i.name === name);
  // Before the conversion, not after it: a video's files go up together or not at all.
  if (video && !name.endsWith('.mp4')) return say('A video goes up as an MP4: name it ending .mp4.', true);
  if (taken && !replace) return say(name + ' is taken. Upload it under a new name (browsers may hold the old one for an hour), or tick Replace.', true);
  $<HTMLButtonElement>('#send').disabled = true;
  hideSteps();
  const fail = (text: string) => {
    $<HTMLButtonElement>('#send').disabled = false;
    hideSteps();
    say(text, true);
    load();
  };
  let body: Blob = f, lost: string[] = [], hls = new Map<string, Uint8Array>();
  if (video) {
    say('Converting ' + f.name + ' (' + size(f.size) + ')…');
    step('convert', 0);
    try {
      ({ blob: body, hls, lost } = await convert(f, name));
    } catch (err) {
      return fail((err as Error).message || 'The conversion failed.');
    }
  }
  const files = [...hls].map(([path, bytes]) => [path, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: path.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4' })] as const);
  const tooBig = [[name, body] as const, ...files].find(([, blob]) => blob.size > LIMIT);
  if (tooBig) return fail((video ? 'Converted, ' + tooBig[0] + ' is ' : 'It is ') + size(tooBig[1].size) + ': over the 100 MB an upload can be. Trim it or split it.');
  // A video's poster, picked before anything goes up; a video still goes up without one.
  let still: Blob | undefined;
  if (video) {
    say('Pick its poster…');
    const local = URL.createObjectURL(body);
    still = await pickPoster(local);
    URL.revokeObjectURL(local);
  }
  // What goes up, in order: the sizes, their playlists, the master playlist that names them,
  // then the MP4 pages name, then its poster. Replacing a video, its old streaming set goes
  // first, so no size it no longer has stays behind.
  const rank = (path: string) => path.endsWith('.m3u8') ? (path.includes('.hls/') ? 1 : 2) : 0;
  const queue: (readonly [string, Blob])[] = [...files].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  queue.push([name, body]);
  if (still) queue.push([posterName(name), still]);
  if (video && taken) {
    const r = await fetch('/admin/api/media/' + encodeURI(streamNames(name).master), { method: 'DELETE' });
    if (!r.ok) return fail('Its old streaming files couldn\'t be cleared (' + r.status + '): nothing was uploaded.');
  }
  const total = queue.reduce((n, [, blob]) => n + blob.size, 0);
  say('Uploading ' + name + ' (' + size(body.size) + ')' + (files.length ? ', its ' + files.length + ' streaming files' : '') + (still ? ' and its poster' : '') + '…');
  step('upload', 0);
  let sent = 0, data: Uploaded = {}, stillNote = '', purgedAny = false, unpurged = false;
  for (const [path, blob] of queue) {
    const up = await put(path, blob, replace, (bytes) => step('upload', (sent + bytes) / total));
    if (up.status !== 200) {
      if (path === posterName(name) && still) {
        stillNote = ' Its poster didn\'t go up: ' + (up.data.error || 'error ' + (up.status || 'network')) + '.';
        break;
      }
      return fail((up.data.error || 'Upload failed (' + (up.status || 'network') + ')') + (path === name ? '' : ' (' + path + '; ' + name + ' wasn\'t uploaded).'));
    }
    if (up.data.purged === true) purgedAny = true;
    if (up.data.purged === false) unpurged = true;
    if (path === name) data = up.data;
    if (path === posterName(name)) stillNote = ' Its poster: ' + up.data.url + '.';
    sent += blob.size;
  }
  if (video && !still) stillNote = ' No poster: its Poster button picks one.';
  $<HTMLButtonElement>('#send').disabled = false;
  hideSteps();
  const cache = unpurged ? ' Cloudflare may serve the old files for up to an hour (its cache could not be cleared).'
    : purgedAny ? ' The old files are cleared from Cloudflare\'s cache (a browser that has them may keep them up to an hour).' : '';
  const mute = lost.length ? ' Its sound couldn\'t be converted on this device, so it has none.' : '';
  const featured = video ? ' (a travelog), or #+FEATURED: ' + data.url + ' (a post)' : '';
  const streams = files.length ? ' It streams in ' + [...hls.keys()].filter((p) => p.includes('.hls/') && p.endsWith('.m3u8')).map((p) => p.slice(p.lastIndexOf('/') + 1, -'.m3u8'.length) + 'p').join(', ') + '.' : '';
  say('Uploaded ' + data.name + ' (' + size(data.size!) + '). Org: ' + org(data as Item) + featured + '.' + streams + stillNote + cache + mute,
    unpurged || Boolean(mute) || stillNote.includes('n\'t'));
  $<HTMLFormElement>('#up').reset();
  $('#note').textContent = 'Up to 100 MB. Videos are made here, in each size the site streams them at, before they go up, with a poster.';
  load();
});
load();

// A module of its own, not a script sharing the global scope with the other admin page.
export {};
