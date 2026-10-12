/* The assets page's script (src/admin.ts serves the page): the list, filtered by name; an
   upload, with its progress; copying an asset's Org line or address; deleting one. Browser
   code: scripts/build.ts bundles it into src/admin-page.gen.ts, which the page inlines. Its
   classes are Tailwind's (src/admin-page.css). */

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
// A name an Org link can carry: lowercase, dashes for spaces and oddities.
$('#file').addEventListener('change', () => {
  const f = $<HTMLInputElement>('#file').files![0];
  if (!f) return;
  $<HTMLInputElement>('#name').value = f.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const mov = /\.(mov|hevc|heic)$/i.test(f.name) || f.type === 'video/quicktime';
  $('#note').innerHTML = mov ? '<span class="text-chile">This looks like an iPhone .mov (often HEVC, which many browsers can\'t play): encode it to MP4 first.</span>'
    : f.size > 100 * 1048576 ? '<span class="text-chile">Over 100 MB: too big for one upload. Encode it smaller.</span>'
    : 'Up to 100 MB. Videos: encode first (H.264 + AAC, yuv420p, faststart; CLAUDE.md has the ffmpeg line).';
});
$('#up').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = $<HTMLInputElement>('#file').files![0];
  const name = $<HTMLInputElement>('#name').value.trim();
  if (!f || !name) return;
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', '/admin/api/media/' + encodeURI(name) + ($<HTMLInputElement>('#replace').checked ? '?replace=1' : ''));
  xhr.setRequestHeader('Content-Type', f.type || 'application/octet-stream');
  $('#bar').hidden = false;
  $<HTMLButtonElement>('#send').disabled = true;
  xhr.upload.onprogress = (p) => { if (p.lengthComputable) $<HTMLProgressElement>('#bar').value = p.loaded / p.total; };
  xhr.onloadend = () => {
    $<HTMLButtonElement>('#send').disabled = false;
    $('#bar').hidden = true;
    let data: { error?: string; name?: string; size?: number; url?: string; type?: string; purged?: boolean } = {};
    try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status !== 200) return say(data.error || 'Upload failed (' + (xhr.status || 'network') + ')', true);
    const cache = data.purged === undefined ? '' : data.purged ? ' The old file is cleared from Cloudflare\'s cache (a browser that has it may keep it up to an hour).'
      : ' Cloudflare may serve the old file for up to an hour (its cache could not be cleared).';
    say('Uploaded ' + data.name + ' (' + size(data.size!) + '). Org: ' + org(data as Item) + cache, data.purged === false);
    $<HTMLFormElement>('#up').reset();
    load();
  };
  xhr.send(f);
});
load();

// A module of its own, not a script sharing the global scope with the other admin page.
export {};
