/* The assets page's script (src/admin.ts serves the page): the list, filtered by name; an
   upload, with its progress; copying an asset's Org line or address; deleting one. A video is
   made an MP4 in the browser before it goes up (convert, below), so an iPhone's .mov can be
   uploaded straight from the phone, and its poster (pickPoster, below) goes up beside it. Browser code: scripts/build.ts bundles it (Mediabunny
   too) into src/admin-page.gen.ts, which the page inlines. Its classes are Tailwind's
   (src/admin-page.css). */

import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_MEDIUM, canEncodeVideo } from 'mediabunny';

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
function thumb(item: Item) {
  const src = item.url;
  if (item.type.startsWith('image/')) return '<img class="' + THUMB + '" loading="lazy" alt="" src="' + esc(src) + '">';
  if (item.type.startsWith('video/')) return '<video class="' + THUMB + '" muted preload="metadata" src="' + esc(src) + '#t=1"></video>';
  return '<span class="' + THUMB + '"></span>';
}
function render() {
  const q = $<HTMLInputElement>('#q').value.trim().toLowerCase();
  const shown = items.filter((i) => !q || i.name.toLowerCase().includes(q));
  $('#rows').innerHTML = shown.map((i, n) => '<tr><td>' + thumb(i) + '</td><td><span class="' + PATH + '">' + esc(i.name) + '</span><small>' + esc(i.type) + '</small></td><td>' + size(i.size) +
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
    if (!confirm('Delete ' + item.name + '? Pages that name it will lose it, and make check fails until they stop.')) return;
    const r = await fetch('/admin/api/media/' + encodeURI(item.name), { method: 'DELETE' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return say(data.error || 'Delete failed (' + r.status + ')', true);
    say('Deleted ' + item.name + (data.purged ? ', and cleared from Cloudflare\'s cache.' : '. Cloudflare may serve it for up to an hour (its cache could not be cleared).'), !data.purged);
    load();
  }
});
$('#q').addEventListener('input', render);
const LIMIT = 100 * 1048576; // the Worker's request limit: one upload
const LONG_SIDE = 1920; // a video's longer side, at most: 4K is far more than a page shows
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

/** F as the site serves videos (CLAUDE.md): an MP4 of H.264 and AAC, its index first
    (faststart), at most LONG_SIDE pixels long, without the file's metadata (an iPhone's
    holds where it was shot). Done in this browser, on its own video hardware (WebCodecs, by
    Mediabunny): what can be copied as it is (H.264, AAC) is, the rest is encoded. */
async function convert(f: File) {
  if (!(await canEncodeVideo('avc'))) throw new Error('This browser can\'t encode H.264 video. Convert it on a computer (CLAUDE.md has the ffmpeg line) and upload the MP4.');
  const target = new BufferTarget();
  const conversion = await Conversion.init({
    input: new Input({ source: new BlobSource(f), formats: ALL_FORMATS }),
    output: new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target }),
    tracks: 'primary',
    tags: {},
    video: (track) => {
      const w = track.displayWidth, h = track.displayHeight;
      return { codec: 'avc', quality: QUALITY_MEDIUM, ...(Math.max(w, h) > LONG_SIDE && (w >= h ? { width: LONG_SIDE } : { height: LONG_SIDE })) };
    },
    audio: { codec: 'aac' },
    showWarnings: false,
  });
  const lost = conversion.discardedTracks.map((d) => d.track.type + ' (' + d.reason.replaceAll('_', ' ') + ')');
  if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.type === 'video')) throw new Error('This video can\'t be converted here: ' + (lost.join(', ') || 'no video in it') + '. Convert it on a computer (CLAUDE.md).');
  conversion.onProgress = (p) => step('convert', p);
  await conversion.execute();
  step('convert', 1);
  return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), lost: lost.filter((t) => t.startsWith('audio')) };
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
  $('#note').innerHTML = isVideo(f) ? 'A video: made an MP4 (H.264, at most ' + LONG_SIDE + 'px, no location or other metadata) on this device first, then uploaded with a JPEG poster of the same name, from the frame you pick. Keep this page open until it\'s done.'
    : f.size > LIMIT ? '<span class="text-chile">Over 100 MB: too big for one upload. Make it smaller.</span>'
    : 'Up to 100 MB. Videos are made MP4s here before they go up, with a poster.';
});
$('#up').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = $<HTMLInputElement>('#file').files![0];
  const name = $<HTMLInputElement>('#name').value.trim();
  if (!f || !name) return;
  $<HTMLButtonElement>('#send').disabled = true;
  hideSteps();
  let body: Blob = f, lost: string[] = [];
  if (isVideo(f)) {
    say('Converting ' + f.name + ' (' + size(f.size) + ')…');
    step('convert', 0);
    try {
      ({ blob: body, lost } = await convert(f));
    } catch (err) {
      $<HTMLButtonElement>('#send').disabled = false;
      return say((err as Error).message || 'The conversion failed.', true);
    }
  }
  if (body.size > LIMIT) {
    $<HTMLButtonElement>('#send').disabled = false;
    return say((isVideo(f) ? 'Converted, it is ' : 'It is ') + size(body.size) + ': over the 100 MB an upload can be. Trim it or split it.', true);
  }
  // A video's poster, picked before anything goes up; a video still goes up without one.
  let still: Blob | undefined;
  if (isVideo(f)) {
    say('Pick its poster…');
    const local = URL.createObjectURL(body);
    still = await pickPoster(local);
    URL.revokeObjectURL(local);
  }
  const stillName = posterName(name);
  const replace = $<HTMLInputElement>('#replace').checked;
  const total = body.size + (still?.size ?? 0);
  say('Uploading ' + name + ' (' + size(body.size) + ')' + (still ? ' and its poster' : '') + '…');
  step('upload', 0);
  const { status, data } = await put(name, body, replace, (bytes) => step('upload', bytes / total));
  let stillNote = '';
  if (status === 200 && still) {
    const up = await put(stillName, still, replace, (bytes) => step('upload', (body.size + bytes) / total));
    stillNote = up.status === 200 ? ' Its poster: ' + up.data.url + '.' : ' Its poster didn\'t go up: ' + (up.data.error || 'error ' + (up.status || 'network')) + '.';
  } else if (status === 200 && isVideo(f)) stillNote = ' No poster: its Poster button picks one.';
  $<HTMLButtonElement>('#send').disabled = false;
  hideSteps();
  if (status !== 200) return say(data.error || 'Upload failed (' + (status || 'network') + ')', true);
  const cache = data.purged === undefined ? '' : data.purged ? ' The old file is cleared from Cloudflare\'s cache (a browser that has it may keep it up to an hour).'
    : ' Cloudflare may serve the old file for up to an hour (its cache could not be cleared).';
  const mute = lost.length ? ' Its sound couldn\'t be converted on this device, so it has none.' : '';
  const featured = isVideo(f) ? ' (a travelog), or #+FEATURED: ' + data.url + ' (a post)' : '';
  say('Uploaded ' + data.name + ' (' + size(data.size!) + '). Org: ' + org(data as Item) + featured + '.' + stillNote + cache + mute,
    data.purged === false || Boolean(mute) || stillNote.includes('n\'t'));
  $<HTMLFormElement>('#up').reset();
  $('#note').textContent = 'Up to 100 MB. Videos are made MP4s here before they go up, with a poster.';
  load();
});
load();

// A module of its own, not a script sharing the global scope with the other admin page.
export {};
