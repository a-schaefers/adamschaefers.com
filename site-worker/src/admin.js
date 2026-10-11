/* The owner's page at /admin: the videos, pictures and files in R2 (the adamschaefers-media
   bucket), which R2 serves at media.adamschaefers.com. Upload one, see each with its size
   and date, copy the address an Org page names it by (#+VIDEO: https://media.adamschaefers.com/evia.mp4,
   or [[https://media.adamschaefers.com/photo.jpg]]), open it, delete it.
   Served only after Cloudflare Access signs the owner in (src/access.js); the page calls
   /admin/api/media on the same origin, and a change from any other origin is refused.

     GET    /admin/api/media              every asset
     PUT    /admin/api/media/<name>       upload (the body is the file); ?replace=1 replaces
     DELETE /admin/api/media/<name>       delete

   A replaced file can stay in caches for up to an hour (its Cache-Control), so a changed
   file is better uploaded under a new name. An upload is one request, up to the Worker's
   100 MB limit: encode videos first (CLAUDE.md), which keeps them far below it. */

import { adminEmail } from './access.js';

// A name an address can carry as is: lowercase words, folders allowed, an extension.
const NAME = /^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.[a-z0-9]+$/;
const CACHE_CONTROL = 'public, max-age=3600';
const TYPES = {
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif',
  pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain; charset=utf-8', json: 'application/json',
};
// Only these: the media domain is same-site with the site and the license server, so nothing
// that a browser would run as a page (HTML, SVG) may be served from it.
const typeOf = (name) => {
  const ext = name.slice(name.lastIndexOf('.') + 1);
  return Object.hasOwn(TYPES, ext) ? TYPES[ext] : undefined; // not x.constructor's
};
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY },
});

// A change must come from this page: not a form or script on another site riding the
// Access cookie.
function sameOrigin(request, url) {
  const site = request.headers.get('Sec-Fetch-Site');
  const origin = request.headers.get('Origin');
  return (!site || site === 'same-origin') && (!origin || origin === url.origin);
}

async function list(env) {
  const items = [];
  for (let cursor; ;) {
    const page = await env.MEDIA.list({ cursor, limit: 1000, include: ['httpMetadata'] });
    for (const o of page.objects) {
      items.push({ name: o.key, url: `${env.MEDIA_ORIGIN}/${o.key}`, size: o.size, uploaded: o.uploaded.toISOString(), type: o.httpMetadata?.contentType || typeOf(o.key) || 'application/octet-stream' });
    }
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  items.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  return items;
}

export async function admin(request, env, url) {
  if (!(await adminEmail(request, env))) return new Response('Forbidden', { status: 403, headers: SECURITY });
  const path = url.pathname;
  if (path === '/admin') return Response.redirect(`${url.origin}/admin/`, 301);
  if (path === '/admin/' && request.method === 'GET') {
    return new Response(PAGE.replaceAll('{{MEDIA_ORIGIN}}', env.MEDIA_ORIGIN), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY },
    });
  }
  if (path === '/admin/api/media' && request.method === 'GET') return json({ items: await list(env) });

  const m = /^\/admin\/api\/media\/(.+)$/.exec(path);
  if (!m) return json({ error: 'Not found' }, 404);
  let name;
  try {
    name = decodeURIComponent(m[1]);
  } catch {
    name = '';
  }
  if (!NAME.test(name) || name.length > 200) {
    return json({ error: 'Name it with lowercase letters, digits, dots, dashes and underscores, folders allowed, and an extension: evia.mp4, posters/evia.jpg.' }, 400);
  }
  if (!sameOrigin(request, url)) return json({ error: 'Changes come from this page only.' }, 403);
  const type = typeOf(name);
  if (request.method === 'PUT' && !type) {
    return json({ error: `Only ${Object.keys(TYPES).join(', ')} files: nothing a browser would run as a page.` }, 400);
  }
  if (request.method === 'DELETE') {
    await env.MEDIA.delete(name);
    return json({ deleted: name });
  }
  if (request.method === 'PUT') {
    if (!request.body || !Number(request.headers.get('Content-Length'))) return json({ error: 'No file came with the upload.' }, 400);
    if (url.searchParams.get('replace') !== '1' && (await env.MEDIA.head(name))) {
      return json({ error: `${name} is taken. Upload it under a new name (caches may hold the old one for an hour), or tick Replace.`, taken: true }, 409);
    }
    const object = await env.MEDIA.put(name, request.body, { httpMetadata: { contentType: type, cacheControl: CACHE_CONTROL } });
    return json({ name: object.key, url: `${env.MEDIA_ORIGIN}/${object.key}`, size: object.size, type });
  }
  return json({ error: 'Method not allowed' }, 405);
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Assets · adamschaefers.com</title>
<style>
  :root { --sky:#161A33; --mesa:#1F2445; --ridge:#2C3260; --sand:#EEE7D7; --dust:#A8A6BE; --turq:#46D3C3; --chile:#E5533D; }
  body { margin:0; padding:1.5rem; background:var(--sky); color:var(--sand); font:15px/1.5 system-ui,sans-serif; }
  h1 { margin:0 0 .25rem; font-size:1.4rem; } .sub { margin:0 0 1.25rem; color:var(--dust); }
  input, button { font:inherit; color:inherit; background:var(--mesa); border:1px solid var(--ridge); border-radius:8px; padding:.45rem .7rem; }
  button { cursor:pointer; } button:hover { border-color:var(--turq); color:var(--turq); } button:disabled { opacity:.5; cursor:default; }
  .card { margin:0 0 1.25rem; background:var(--mesa); border:1px solid var(--ridge); border-radius:12px; padding:1rem; display:grid; gap:.6rem; max-width:44rem; }
  .row { display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; } .row input[type=text] { flex:1; min-width:16rem; }
  progress { width:100%; accent-color:var(--turq); } .hint { color:var(--dust); font-size:.85rem; margin:0; }
  .warn { color:var(--chile); } #msg { min-height:1.5em; color:var(--turq); } #msg.err { color:var(--chile); }
  table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:.5rem; border-bottom:1px solid var(--ridge); vertical-align:middle; }
  th { color:var(--dust); font-weight:600; font-size:.85rem; } td small { color:var(--dust); display:block; }
  .thumb { width:96px; height:54px; object-fit:cover; border-radius:6px; background:var(--ridge); display:block; }
  .path { font:13px/1.4 ui-monospace,monospace; word-break:break-all; }
  .actions { display:flex; gap:.35rem; flex-wrap:wrap; } .actions button { padding:.25rem .55rem; font-size:.85rem; }
  a { color:var(--turq); } code { font:13px ui-monospace,monospace; background:var(--ridge); padding:.1em .35em; border-radius:4px; }
</style></head>
<body>
<h1>Assets</h1>
<p class="sub">Videos, pictures and files, served at <code>{{MEDIA_ORIGIN}}/</code>. Copy one's Org line or address into a page. <a href="https://licenses.adamschaefers.com/admin">Licenses admin</a></p>
<form class="card" id="up">
  <div class="row"><input type="file" id="file" required><input type="text" id="name" placeholder="Name: evia.mp4, posters/evia.jpg" required></div>
  <div class="row"><label><input type="checkbox" id="replace"> Replace if taken</label><button id="send">Upload</button></div>
  <progress id="bar" max="1" value="0" hidden></progress>
  <p class="hint" id="note">Up to 100 MB. Videos: encode first (H.264 + AAC, yuv420p, faststart; CLAUDE.md has the ffmpeg line).</p>
</form>
<div class="row" style="margin-bottom:1rem"><input type="text" id="q" placeholder="Filter by name"></div>
<p id="msg"></p>
<table><thead><tr><th></th><th>Asset</th><th>Size</th><th>Uploaded</th><th></th></tr></thead><tbody id="rows"></tbody></table>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
let items = [];
function say(text, bad) { $('#msg').textContent = text; $('#msg').className = bad ? 'err' : ''; }
const size = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
// How an Org page names it: a travelog's video, an inline picture, a link to anything else.
function org(item) {
  if (item.type.startsWith('video/')) return '#+VIDEO: ' + item.url;
  if (item.type.startsWith('image/')) return '[[' + item.url + ']]';
  return '[[' + item.url + '][' + item.name + ']]';
}
function thumb(item) {
  const src = item.url;
  if (item.type.startsWith('image/')) return '<img class="thumb" loading="lazy" alt="" src="' + esc(src) + '">';
  if (item.type.startsWith('video/')) return '<video class="thumb" muted preload="metadata" src="' + esc(src) + '#t=1"></video>';
  return '<span class="thumb"></span>';
}
function render() {
  const q = $('#q').value.trim().toLowerCase();
  const shown = items.filter((i) => !q || i.name.toLowerCase().includes(q));
  $('#rows').innerHTML = shown.map((i, n) => '<tr><td>' + thumb(i) + '</td><td><span class="path">' + esc(i.name) + '</span><small>' + esc(i.type) + '</small></td><td>' + size(i.size) +
    '</td><td>' + esc(new Date(i.uploaded).toLocaleString()) + '</td><td class="actions">' +
    '<button data-n="' + n + '" data-do="org">Copy Org</button><button data-n="' + n + '" data-do="url">Copy address</button>' +
    '<a href="' + esc(i.url) + '" target="_blank" rel="noopener"><button type="button">Open</button></a><button data-n="' + n + '" data-do="delete">Delete</button></td></tr>').join('') ||
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
async function copy(text) {
  try { await navigator.clipboard.writeText(text); say('Copied: ' + text); } catch { prompt('Copy:', text); }
}
$('#rows').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-do]');
  if (!b) return;
  const item = items[JSON.parse($('#rows').dataset.shown)[b.dataset.n]];
  if (b.dataset.do === 'org') return copy(org(item));
  if (b.dataset.do === 'url') return copy(item.url);
  if (b.dataset.do === 'delete') {
    if (!confirm('Delete ' + item.name + '? Pages that name it will lose it, and make check fails until they stop.')) return;
    const r = await fetch('/admin/api/media/' + encodeURI(item.name), { method: 'DELETE' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return say(data.error || 'Delete failed (' + r.status + ')', true);
    say('Deleted ' + item.name);
    load();
  }
});
$('#q').addEventListener('input', render);
// A name an Org link can carry: lowercase, dashes for spaces and oddities.
$('#file').addEventListener('change', () => {
  const f = $('#file').files[0];
  if (!f) return;
  $('#name').value = f.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const mov = /\\.(mov|hevc|heic)$/i.test(f.name) || f.type === 'video/quicktime';
  $('#note').innerHTML = mov ? '<span class="warn">This looks like an iPhone .mov (often HEVC, which many browsers can\\'t play): encode it to MP4 first.</span>'
    : f.size > 100 * 1048576 ? '<span class="warn">Over 100 MB: too big for one upload. Encode it smaller.</span>'
    : 'Up to 100 MB. Videos: encode first (H.264 + AAC, yuv420p, faststart; CLAUDE.md has the ffmpeg line).';
});
$('#up').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = $('#file').files[0];
  const name = $('#name').value.trim();
  if (!f || !name) return;
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', '/admin/api/media/' + encodeURI(name) + ($('#replace').checked ? '?replace=1' : ''));
  xhr.setRequestHeader('Content-Type', f.type || 'application/octet-stream');
  $('#bar').hidden = false;
  $('#send').disabled = true;
  xhr.upload.onprogress = (p) => { if (p.lengthComputable) $('#bar').value = p.loaded / p.total; };
  xhr.onloadend = () => {
    $('#send').disabled = false;
    $('#bar').hidden = true;
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status !== 200) return say(data.error || 'Upload failed (' + (xhr.status || 'network') + ')', true);
    say('Uploaded ' + data.name + ' (' + size(data.size) + '). Org: ' + org(data));
    $('#up').reset();
    load();
  };
  xhr.send(f);
});
load();
</script>
</body></html>`;
