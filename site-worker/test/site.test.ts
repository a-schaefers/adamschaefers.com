// The site Worker, offline: static assets, R2, Cloudflare Access and the purge API are fakes.
//   node --test site-worker/test/*.test.ts

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import worker from '../src/index.ts';
import type { Env } from '../src/index.ts';

const ORIGIN = 'https://adamschaefers.com';
const toBase64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

// Access: one RSA pair whose public half the Worker fetches from the team's certs.
const pair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']) as CryptoKeyPair;
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey), kid: 'k1' };
// The purge API: each request's zone, token and files, answered `purgeAnswer`.
let purges: { zone: string; token: string | null; files: string[] }[];
let purgeAnswer: { success: boolean };
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  if (String(url) === 'https://team.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  const purge = /^https:\/\/api\.cloudflare\.com\/client\/v4\/zones\/(\w+)\/purge_cache$/.exec(String(url));
  if (purge && init?.method === 'POST') {
    purges.push({ zone: purge[1], token: new Headers(init.headers).get('Authorization'), files: JSON.parse(String(init.body)).files });
    return Response.json(purgeAnswer);
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;
async function token(claims: Record<string, unknown> = {}) {
  const enc = (o: unknown) => toBase64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: 'RS256', kid: 'k1' });
  const body = enc({ aud: ['aud123'], iss: 'https://team.cloudflareaccess.com', exp: Math.floor(Date.now() / 1000) + 600, email: 'adam.schaefers@icloud.com', ...claims });
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${toBase64url(sig)}`;
}

// R2: a Map of name -> { data, type, cacheControl, uploaded }.
interface Stored { data: Buffer; type: string; cacheControl?: string; uploaded: Date }
let bucket: Map<string, Stored>;
const env = {
  MEDIA_ORIGIN: 'https://media.adamschaefers.com',
  ACCESS_TEAM: 'team.cloudflareaccess.com',
  ACCESS_AUD: 'aud123',
  ADMIN_EMAIL: 'adam.schaefers@icloud.com',
  ZONE_ID: 'zone123',
  PURGE_TOKEN: 'purge-token',
  ASSETS: { fetch: async (request: Request) => new Response(`asset ${new URL(request.url).pathname}`) },
  MEDIA: {
    async list() {
      const objects = [...bucket].map(([key, o]) => ({ key, size: o.data.length, uploaded: o.uploaded, httpMetadata: { contentType: o.type } }));
      return { objects, truncated: false };
    },
    async head(key: string) {
      return bucket.has(key) ? { key } : null;
    },
    async put(key: string, body: BodyInit, options: { httpMetadata: { contentType: string; cacheControl: string } }) {
      const data = Buffer.from(await new Response(body).arrayBuffer());
      bucket.set(key, { data, type: options.httpMetadata.contentType, cacheControl: options.httpMetadata.cacheControl, uploaded: new Date() });
      return { key, size: data.length };
    },
    async delete(key: string) {
      bucket.delete(key);
    },
  },
} as unknown as Env;

beforeEach(() => {
  purges = [];
  purgeAnswer = { success: true };
  env.PURGE_TOKEN = 'purge-token';
  bucket = new Map([['evia.mp4', { data: Buffer.from('0123456789'), type: 'video/mp4', uploaded: new Date('2026-10-01T00:00:00Z') }]]);
});

async function call(method: string, path: string, { headers = {}, body, signedIn = true }: { headers?: Record<string, string>; body?: string; signedIn?: boolean } = {}) {
  const h: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin', ...headers };
  if (signedIn) h['Cf-Access-Jwt-Assertion'] = await token();
  if (body !== undefined) h['Content-Length'] = String(Buffer.byteLength(body));
  return worker.fetch(new Request(ORIGIN + path, { method, headers: h, body }), env);
}

test('anything but /admin is the static site', async () => {
  const r = await worker.fetch(new Request(`${ORIGIN}/store/`), env);
  assert.equal(await r.text(), 'asset /store/');
});

test('/admin needs a valid Access token for the admin email', async () => {
  assert.equal((await call('GET', '/admin/', { signedIn: false })).status, 403);
  for (const claims of [{ email: 'someone@else.test' }, { aud: ['other'] }, { exp: 1 }, { iss: 'https://evil.cloudflareaccess.com' }]) {
    const r = await worker.fetch(new Request(`${ORIGIN}/admin/`, { headers: { 'Cf-Access-Jwt-Assertion': await token(claims) } }), env);
    assert.equal(r.status, 403, JSON.stringify(claims));
  }
  const page = await call('GET', '/admin/');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  assert.match(await page.text(), /https:\/\/media\.adamschaefers\.com\//);
  const bare = await call('GET', '/admin');
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get('Location'), `${ORIGIN}/admin/`);
});

test('the list gives each asset its address on the media domain', async () => {
  const r = await call('GET', '/admin/api/media');
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const { items } = await r.json<{ items: { name: string; url: string; size: number; type: string }[] }>();
  assert.deepEqual(items.map(({ name, url, size, type }) => ({ name, url, size, type })),
    [{ name: 'evia.mp4', url: 'https://media.adamschaefers.com/evia.mp4', size: 10, type: 'video/mp4' }]);
});

test('an upload stores the file with its type and an hour of caching, and answers its address', async () => {
  const r = await call('PUT', '/admin/api/media/posters/evia.jpg', { body: 'jpegbytes' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { name: 'posters/evia.jpg', url: 'https://media.adamschaefers.com/posters/evia.jpg', size: 9, type: 'image/jpeg' });
  const stored = bucket.get('posters/evia.jpg')!;
  assert.equal(stored.data.toString(), 'jpegbytes');
  assert.equal(stored.type, 'image/jpeg');
  assert.equal(stored.cacheControl, 'public, max-age=3600');
  assert.deepEqual(purges, [], 'a new name was never cached: nothing to purge');
});

test('a taken name is refused unless Replace is ticked', async () => {
  const taken = await call('PUT', '/admin/api/media/evia.mp4', { body: 'new' });
  assert.equal(taken.status, 409);
  assert.equal(bucket.get('evia.mp4')!.data.toString(), '0123456789');
  assert.equal((await call('PUT', '/admin/api/media/evia.mp4?replace=1', { body: 'new' })).status, 200);
  assert.equal(bucket.get('evia.mp4')!.data.toString(), 'new');
});

test("a replaced file is purged from Cloudflare's cache, and the answer says so", async () => {
  const r = await call('PUT', '/admin/api/media/evia.mp4?replace=1', { body: 'new' });
  assert.equal((await r.json() as { purged?: boolean }).purged, true);
  assert.deepEqual(purges, [{ zone: 'zone123', token: 'Bearer purge-token', files: ['https://media.adamschaefers.com/evia.mp4'] }]);
});

test('a purge that cannot happen never fails the change: the answer says the cache may lag', async () => {
  purgeAnswer = { success: false };
  let r = await call('PUT', '/admin/api/media/evia.mp4?replace=1', { body: 'new' });
  assert.equal(r.status, 200);
  assert.equal((await r.json() as { purged?: boolean }).purged, false);
  env.PURGE_TOKEN = undefined;
  r = await call('DELETE', '/admin/api/media/evia.mp4');
  assert.deepEqual(await r.json(), { deleted: 'evia.mp4', purged: false });
  assert.equal(bucket.size, 0);
  assert.equal(purges.length, 1, 'no token, no request');
});

test('names an address can carry as is, nothing else', async () => {
  for (const name of ['Evia.mp4', 'evia', 'evia%20one.mp4', '.hidden.jpg', 'a//b.jpg', 'a/.b.jpg', '-x.jpg']) {
    const r = await call('PUT', `/admin/api/media/${name}`, { body: 'x' });
    assert.equal(r.status, 400, name);
  }
  // Dot segments, plain or encoded, are resolved by the URL before the Worker sees the path.
  assert.equal((await call('PUT', '/admin/api/media/%2e%2e/evia.mp4', { body: 'x' })).status, 404);
  assert.deepEqual([...bucket.keys()], ['evia.mp4']);
});

test('a change from another origin is refused', async () => {
  for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { Origin: 'https://evil.test' }] as Record<string, string>[]) {
    assert.equal((await call('DELETE', '/admin/api/media/evia.mp4', { headers })).status, 403, JSON.stringify(headers));
    assert.equal((await call('PUT', '/admin/api/media/x.jpg', { headers, body: 'x' })).status, 403, JSON.stringify(headers));
  }
  assert.ok(bucket.has('evia.mp4'));
});

test('delete removes the asset', async () => {
  const r = await call('DELETE', '/admin/api/media/evia.mp4');
  assert.deepEqual(await r.json(), { deleted: 'evia.mp4', purged: true });
  assert.equal(bucket.size, 0);
  assert.deepEqual(purges.map((p) => p.files), [['https://media.adamschaefers.com/evia.mp4']]);
});

test('an upload with no file is refused', async () => {
  assert.equal((await call('PUT', '/admin/api/media/x.jpg', { body: '' })).status, 400);
});

test('wrangler.jsonc: no Workers caching, and only /admin runs the script', () => {
  const config = readFileSync(fileURLToPath(new URL('../wrangler.jsonc', import.meta.url).href), 'utf8');
  const code = config.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /"cache"\s*:/, 'Workers caching would bill every static asset request as the Worker\'s');
  assert.match(code, /"run_worker_first":\s*\["\/admin",\s*"\/admin\/\*"\]/);
  assert.match(code, /"not_found_handling":\s*"404-page"/);
});

test('only types that cannot run as a page: no HTML, no SVG, nothing unknown', async () => {
  for (const name of ['page.html', 'logo.svg', 'tool.exe', 'notes.htm', 'x.constructor', 'x.tostring']) {
    const r = await call('PUT', `/admin/api/media/${name}`, { body: '<script>alert(1)</script>' });
    assert.equal(r.status, 400, name);
  }
  assert.deepEqual([...bucket.keys()], ['evia.mp4']);
});
