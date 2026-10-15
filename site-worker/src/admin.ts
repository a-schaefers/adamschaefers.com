/* The owner's page at /admin: the videos, pictures and files in R2 (the adamschaefers-media
   bucket), which R2 serves at media.adamschaefers.com. Upload one, see each with its size
   and date, copy the address an Org page names it by (#+VIDEO: https://media.adamschaefers.com/evia.mp4,
   or [[https://media.adamschaefers.com/photo.jpg]]), open it, delete it.
   Served only after Cloudflare Access signs the owner in (src/access.ts); the page calls
   /admin/api/media on the same origin, and a change from any other origin is refused.

     GET    /admin/api/media              every asset
     GET    /admin/api/media/<name>       the file itself, ranges too (a video seeks): from this
                                          origin, the page can take a video's frame for its poster
     PUT    /admin/api/media/<name>       upload (the body is the file); ?replace=1 replaces
     DELETE /admin/api/media/<name>       delete; a video's (NAME.mp4) or its playlist's (NAME.m3u8)
                                          takes its whole HLS set with it: NAME.m3u8 and NAME.hls/

   A video streams as more than its MP4: the page uploads NAME.m3u8 and NAME.hls/ beside it,
   the same video in up to three sizes (ladder.ts), which the site's player streams from.

   Cloudflare's edge keeps a media file an hour (its Cache-Control), so a replaced or deleted
   one is purged from it at once (2026-10-11, the zone's purge API with PURGE_TOKEN, a Worker
   secret); the answer says whether that worked. A browser that already has the old file
   keeps it up to that hour, which no purge reaches, so a changed file is still better
   uploaded under a new name. An upload is one request, up to the Worker's 100 MB limit: the
   page makes a video an MP4 first (admin-page.ts), which keeps it far below that. */

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
  m3u8: 'application/vnd.apple.mpegurl', // a video's HLS playlists (ladder.ts)
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

/** Clear Cloudflare's copy of each of URLS. Never fails the change it follows: false when it
    didn't happen (no PURGE_TOKEN, or Cloudflare refused), and the page says caches may lag. */
async function purge(env: Env, ...urls: string[]) {
  if (!env.PURGE_TOKEN) return false;
  try {
    let purged = true;
    // Cloudflare takes up to 30 addresses a request.
    for (let i = 0; i < urls.length; i += 30) {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/purge_cache`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.PURGE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: urls.slice(i, i + 30) }),
      });
      purged &&= ((await r.json()) as { success?: boolean }).success === true;
    }
    return purged;
  } catch {
    return false;
  }
}

/** What deleting NAME deletes: NAME, and for a video (NAME.mp4) or its playlist (NAME.m3u8)
    the rest of its HLS set, NAME.m3u8 and everything in NAME.hls/. */
async function deletion(env: Env, name: string) {
  const names = [name];
  const stream = /^(.+)\.(?:mp4|m3u8)$/.exec(name);
  if (stream && !name.includes('.hls/')) {
    if (await env.MEDIA.head(`${stream[1]}.m3u8`)) names.push(`${stream[1]}.m3u8`);
    for (let cursor: string | undefined; ;) {
      const page = await env.MEDIA.list({ prefix: `${stream[1]}.hls/`, cursor, limit: 1000 });
      names.push(...page.objects.map((o) => o.key));
      if (!page.truncated) break;
      cursor = page.cursor;
    }
  }
  return [...new Set(names)];
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
  if (request.method === 'GET') {
    let object;
    try {
      object = await env.MEDIA.get(name, { range: request.headers });
    } catch {
      return json({ error: 'That range is not in the file.' }, 416);
    }
    if (!object) return json({ error: 'Not found' }, 404);
    const headers = new Headers({ 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', ...SECURITY });
    const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
    if (!range || !request.headers.has('Range')) return new Response(object.body, { headers });
    const offset = range.suffix !== undefined ? object.size - range.suffix : range.offset ?? 0;
    const length = range.suffix ?? range.length ?? object.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  if (request.method === 'DELETE') {
    const names = await deletion(env, name);
    await env.MEDIA.delete(names);
    return json({ deleted: names, purged: await purge(env, ...names.map((n) => `${env.MEDIA_ORIGIN}/${n}`)) });
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
  <div class="flex items-center gap-2 text-[.85rem]" id="convert" hidden><span class="w-20 text-dust">Converting</span><progress class="flex-1" max="1" value="0"></progress><output class="w-10 text-right tabular-nums">0%</output></div>
  <div class="flex items-center gap-2 text-[.85rem]" id="upload" hidden><span class="w-20 text-dust">Uploading</span><progress class="flex-1" max="1" value="0"></progress><output class="w-10 text-right tabular-nums">0%</output></div>
  <p class="m-0 text-[.85rem] text-dust" id="note">Up to 100 MB. Videos are made here, in each size the site streams them at, before they go up, with a poster.</p>
</form>
<div class="mb-4 flex flex-wrap items-center gap-2"><input class="min-w-64 flex-1" type="text" id="q" placeholder="Filter by name"></div>
<p class="min-h-[1.5em] text-turq [&.err]:text-chile" id="msg"></p>
<table><thead><tr><th></th><th>Asset</th><th>Size</th><th>Uploaded</th><th></th></tr></thead><tbody id="rows"></tbody></table>
<dialog class="m-auto max-w-[min(94vw,36rem)] rounded-xl border border-ridge bg-mesa p-4 text-sand backdrop:bg-black/70" id="pick">
  <p class="m-0 mb-3">Its poster: play or drag to the frame you want, then use it.</p>
  <video class="mx-auto mb-3 block max-h-[60vh] max-w-full bg-black" id="pick-video" controls playsinline muted preload="auto"></video>
  <div class="flex flex-wrap gap-2"><button id="pick-use" type="button">Use this frame</button><button id="pick-skip" type="button">No poster</button></div>
</dialog>
<script>${SCRIPT}</script>
</body></html>`;
