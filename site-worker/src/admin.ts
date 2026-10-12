/* The owner's page at /admin: the videos, pictures and files in R2 (the adamschaefers-media
   bucket), which R2 serves at media.adamschaefers.com. Upload one, see each with its size
   and date, copy the address an Org page names it by (#+VIDEO: https://media.adamschaefers.com/evia.mp4,
   or [[https://media.adamschaefers.com/photo.jpg]]), open it, delete it.
   Served only after Cloudflare Access signs the owner in (src/access.ts); the page calls
   /admin/api/media on the same origin, and a change from any other origin is refused.

     GET    /admin/api/media              every asset
     PUT    /admin/api/media/<name>       upload (the body is the file); ?replace=1 replaces
     DELETE /admin/api/media/<name>       delete

   Cloudflare's edge keeps a media file an hour (its Cache-Control), so a replaced or deleted
   one is purged from it at once (2026-10-11, the zone's purge API with PURGE_TOKEN, a Worker
   secret); the answer says whether that worked. A browser that already has the old file
   keeps it up to that hour, which no purge reaches, so a changed file is still better
   uploaded under a new name. An upload is one request, up to the Worker's 100 MB limit:
   encode videos first (CLAUDE.md), which keeps them far below it. */

import { adminEmail } from './access.ts';
import { SCRIPT, STYLE } from './admin-page.gen.ts';
import type { Env } from './index.ts';

// A name an address can carry as is: lowercase words, folders allowed, an extension.
const NAME = /^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.[a-z0-9]+$/;
const CACHE_CONTROL = 'public, max-age=3600';
const TYPES: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif',
  pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain; charset=utf-8', json: 'application/json',
};
// Only these: the media domain is same-site with the site and the license server, so nothing
// that a browser would run as a page (HTML, SVG) may be served from it.
const typeOf = (name: string) => {
  const ext = name.slice(name.lastIndexOf('.') + 1);
  return Object.hasOwn(TYPES, ext) ? TYPES[ext] : undefined; // not x.constructor's
};
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY },
});

/** Clear Cloudflare's copy of URL. Never fails the change it follows: false when it didn't
    happen (no PURGE_TOKEN, or Cloudflare refused), and the page says caches may lag. */
async function purge(env: Env, url: string) {
  if (!env.PURGE_TOKEN) return false;
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.PURGE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [url] }),
    });
    return ((await r.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}

// A change must come from this page: not a form or script on another site riding the
// Access cookie.
function sameOrigin(request: Request, url: URL) {
  const site = request.headers.get('Sec-Fetch-Site');
  const origin = request.headers.get('Origin');
  return (!site || site === 'same-origin') && (!origin || origin === url.origin);
}

async function list(env: Env) {
  const items: { name: string; url: string; size: number; uploaded: string; type: string }[] = [];
  for (let cursor: string | undefined; ;) {
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

export async function admin(request: Request, env: Env, url: URL) {
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
    return json({ deleted: name, purged: await purge(env, `${env.MEDIA_ORIGIN}/${name}`) });
  }
  if (request.method === 'PUT') {
    if (!request.body || !Number(request.headers.get('Content-Length'))) return json({ error: 'No file came with the upload.' }, 400);
    const taken = Boolean(await env.MEDIA.head(name));
    if (url.searchParams.get('replace') !== '1' && taken) {
      return json({ error: `${name} is taken. Upload it under a new name (browsers may hold the old one for an hour), or tick Replace.`, taken: true }, 409);
    }
    const object = (await env.MEDIA.put(name, request.body, { httpMetadata: { contentType: type, cacheControl: CACHE_CONTROL } }))!;
    const address = `${env.MEDIA_ORIGIN}/${object.key}`;
    // A new name was never cached: only a replaced file needs its old copy purged.
    return json({ name: object.key, url: address, size: object.size, type, ...(taken && { purged: await purge(env, address) }) });
  }
  return json({ error: 'Method not allowed' }, 405);
}

// The page: its styles and script are compiled from src/admin-page.css and src/admin-page.ts
// (scripts/build.ts) and inlined; its classes are Tailwind's.
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Assets · adamschaefers.com</title>
<style>${STYLE}</style></head>
<body>
<h1>Assets</h1>
<p class="m-0 mb-5 text-dust">Videos, pictures and files, served at <code>{{MEDIA_ORIGIN}}/</code>. Copy one's Org line or address into a page. <a href="https://licenses.adamschaefers.com/admin">Licenses admin</a></p>
<form class="m-0 mb-5 grid max-w-[44rem] gap-[.6rem] rounded-xl border border-ridge bg-mesa p-4" id="up">
  <div class="flex flex-wrap items-center gap-2"><input type="file" id="file" required><input class="min-w-64 flex-1" type="text" id="name" placeholder="Name: evia.mp4, posters/evia.jpg" required></div>
  <div class="flex flex-wrap items-center gap-2"><label><input type="checkbox" id="replace"> Replace if taken</label><button id="send">Upload</button></div>
  <progress id="bar" max="1" value="0" hidden></progress>
  <p class="m-0 text-[.85rem] text-dust" id="note">Up to 100 MB. Videos: encode first (H.264 + AAC, yuv420p, faststart; CLAUDE.md has the ffmpeg line).</p>
</form>
<div class="mb-4 flex flex-wrap items-center gap-2"><input class="min-w-64 flex-1" type="text" id="q" placeholder="Filter by name"></div>
<p class="min-h-[1.5em] text-turq [&.err]:text-chile" id="msg"></p>
<table><thead><tr><th></th><th>Asset</th><th>Size</th><th>Uploaded</th><th></th></tr></thead><tbody id="rows"></tbody></table>
<script>${SCRIPT}</script>
</body></html>`;
