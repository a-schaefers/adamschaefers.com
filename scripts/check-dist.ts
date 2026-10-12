#!/usr/bin/env node
// Check public/ (make dist) before it ships: every link resolves, and it fits Workers
// Static Assets. make check runs it; so does CI, on every pull request.
//
// Every href, src and poster in the pages (also inside the #site-data JSON), every url() in
// the styles, every preview picture and every link in the feed must name a file in public/
// (or a page's directory). A script's relative imports must reach a published file: esbuild
// bundles src/app.ts whole (scripts/build.ts), so it has none, and one that isn't published
// (a chunk, were the bundle ever split) fails here rather than on the site. Links to the media
// domain (videos and uploads, https://media.adamschaefers.com/...) are asked for with HEAD:
// each must be there. And each file is under the 25 MiB a static asset may be.
//
// The cache names: every hashed file (js/app.<hash>.js, site.<hash>.css, the fonts) carries
// the first ten hex of its own sha1, which browsers keep for good on the strength of; and
// version.json names exactly the script and styles every page loads (src/version.ts asks it
// whether an open tab is behind a deploy).
//
//   node scripts/check-dist.ts             MEDIA_ORIGIN overrides https://media.adamschaefers.com

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC = join(ROOT, 'public');
const SITE = 'https://adamschaefers.com/';
const MEDIA = `${(process.env.MEDIA_ORIGIN || 'https://media.adamschaefers.com').replace(/\/$/, '')}/`;
const LIMIT = 25 * 1024 * 1024;

function fail(message: string): never {
  console.error(`check-dist: ${message}`);
  process.exit(1);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

let paths: string[] = [];
try {
  paths = walk(PUBLIC);
} catch {
  fail('no public/: run make build first');
}
const files = new Map(paths.map((p) => [relative(PUBLIC, p), p]));
for (const page of ['index.html', '404.html']) if (!files.has(page)) fail(`public/ has no ${page}`);
const big = [...files].filter(([, p]) => statSync(p).size > LIMIT).map(([k]) => k);
if (big.length) fail(`over 25 MiB, too big for a static asset (upload it at /admin instead): ${big.join(', ')}`);

const exists = (path: string) => path === '' ? files.has('index.html')
  : path.endsWith('/') ? files.has(`${path}index.html`)
  : files.has(path) || files.has(`${path}/index.html`);

const broken: string[] = [];
const media = new Map<string, string[]>(); // media URL -> the files that name it
function target(ref: string) {
  let path = ref.replace(/[?#].*$/s, '');
  if (path.startsWith(SITE)) path = path.slice(SITE.length);
  else if (path.startsWith('/') && !path.startsWith('//')) path = path.slice(1);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return null; // elsewhere
  try {
    return decodeURIComponent(path);
  } catch {
    return ref;
  }
}
function note(key: string, ref: string) {
  if (ref === '' || ref.startsWith('#')) return;
  if (ref.startsWith(MEDIA)) {
    const url = ref.replace(/#.*$/s, '');
    media.set(url, [...(media.get(url) || []), key]);
    return;
  }
  const path = target(ref);
  if (path !== null && !exists(path)) broken.push(`${key}: ${ref}`);
}

for (const [key, path] of files) {
  if (key.endsWith('.js')) {
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
      const imported = new URL(m[1], `${SITE}${key}`).pathname.slice(1);
      if (!files.has(imported)) broken.push(`${key}: ${m[1]} (not published: scripts/build.ts bundles what src/app.ts imports)`);
    }
    continue;
  }
  if (!/\.(html|css|xml)$/.test(key)) continue;
  const text = readFileSync(path, 'utf8');
  for (const m of text.matchAll(/\b(?:href|src|poster)=\\?"([^"\\]*)\\?"/g)) note(key, m[1]);
  for (const m of text.matchAll(/\bcontent=\\?"(https:\/\/[^"\\]*)\\?"/g)) note(key, m[1]);
  for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) if (!m[1].startsWith('data:')) note(key, m[1]);
  if (key.endsWith('.xml')) {
    for (const m of text.matchAll(/<(?:link|loc)>(https:\/\/[^<]*)</g)) note(key, m[1]);
    for (const m of text.matchAll(/\burl="(https:\/\/[^"]*)"/g)) note(key, m[1]);
  }
}

// The cache names.
const hashed = [...files.keys()].filter((k) => /\.[0-9a-f]{10}\.(js|css|woff2)$/.test(k));
for (const k of hashed) {
  const want = createHash('sha1').update(readFileSync(files.get(k)!)).digest('hex').slice(0, 10);
  if (!k.includes(`.${want}.`)) broken.push(`${k}: named for a hash that isn't its content's (${want})`);
}
let version: { build?: string, assets?: Record<string, string> } = {};
try {
  version = JSON.parse(readFileSync(join(PUBLIC, 'version.json'), 'utf8'));
} catch {
  broken.push('version.json: missing or not JSON');
}
const named = Object.entries(version.assets ?? {}).map(([name, hash]) => name.replace(/\.(js|css)$/, `.${hash}.$1`));
if (!/^[0-9a-f]{12}$/.test(version.build ?? '') || named.length !== 2) broken.push(`version.json: not {build, assets: {app.js, site.css}}: ${JSON.stringify(version)}`);
for (const [k, p] of files) {
  if (!k.endsWith('.html')) continue;
  const html = readFileSync(p, 'utf8');
  for (const n of named) if (!html.includes(n)) broken.push(`${k}: doesn't load ${n}, which version.json names`);
}

// The media links: each must answer.
await Promise.all([...media.keys()].map(async (url) => {
  let status: number | string;
  try {
    status = (await fetch(url, { method: 'HEAD' })).status;
  } catch (err) {
    status = (err as Error).message;
  }
  if (status !== 200) broken.push(`${media.get(url)![0]}: ${url} (${status}; upload it at https://adamschaefers.com/admin/)`);
}));

if (broken.length) fail(`${broken.length} broken link(s):\n  ${[...new Set(broken)].join('\n  ')}`);
console.log(`check-dist: ${files.size} files, every link resolves (${media.size} on the media domain), ${hashed.length} hashed names true, version ${version.build}`);
