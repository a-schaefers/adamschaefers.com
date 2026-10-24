#!/usr/bin/env node
// Check public/ (make dist) before it ships: every link resolves, and it fits Workers
// Static Assets. make check runs it; so does CI, on every pull request.
//
// Every href, src, poster and data-hls in the pages (also inside the #site-data JSON, with each
// entry's video playlist, hls, and hls.js's address, hlsjs), every url() in the styles, every
// preview picture and every link in the feed must name a file in public/ (or a page's
// directory). A script's relative imports must reach a published file: esbuild
// bundles src/app.ts whole (scripts/build.ts), so it has none, and one that isn't published
// (a chunk, were the bundle ever split) fails here rather than on the site. (The one script it
// loads later, js/hls.<hash>.js, it names by the address in #site-data, checked as a link.) Links to the media
// domain (videos and uploads, https://media.adamschaefers.com/...) are asked for with HEAD:
// each must be there. And each file is under the 25 MiB a static asset may be.
//
// The cache names: every hashed file (js/app.<hash>.js, site.<hash>.css, the fonts) carries
// the first ten hex of its own sha1, which browsers keep for good on the strength of; and
// version.json names exactly the script and styles every page loads (src/version.ts asks it
// whether an open tab is behind a deploy).
//
// And no draft: nothing from a collection's drafts/ folder (content/blog/drafts/) may be in
// public/ or build/, neither a file of the folder (its .KEEP, a picture) nor anything of a
// draft in it (its page, its place in a listing or #site-data, its feed item, its sitemap
// entry, the build's list of drafts). Only a local build has them (site.el's site--drafts-p):
// CI's and make check's (DRAFTS=0) never do, and one that did fails here before it ships.
//
//   node scripts/check-dist.ts             MEDIA_ORIGIN overrides https://media.adamschaefers.com

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

// No draft. Each draft is known by its collection's folder (its route) and its slug, found
// on disk, so a draft is caught whatever the build made of it.
{
  const CONTENT = join(ROOT, 'content');
  const BUILD = join(ROOT, 'build');
  const drafts = readdirSync(CONTENT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CONTENT, d.name, 'drafts')))
    .flatMap((d) => readdirSync(join(CONTENT, d.name, 'drafts'))
      .filter((n) => n.endsWith('.org') && !/^[.#]/.test(n))
      .map((n) => ({ route: d.name, slug: n.slice(0, -'.org'.length) })));
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leaks: string[] = [];
  for (const [key] of files) if (/^[^/]+\/drafts\//.test(key)) leaks.push(`public/${key}: a drafts/ folder's file`);
  const texts = [...[...files].map(([k, p]) => [`public/${k}`, p]),
    ...(existsSync(BUILD) ? walk(BUILD).map((p) => [relative(ROOT, p), p]) : [])]
    .filter(([k]) => /\.(html|xml|txt|json)$/.test(k) && !k.startsWith('build/dist/'));
  for (const [key, path] of texts) {
    const text = readFileSync(path, 'utf8');
    if (key === 'build/drafts.txt' && text.trim()) leaks.push(`${key}: lists drafts (${text.trim().split('\n').join(', ')})`);
    if (/"draft":true/.test(text)) leaks.push(`${key}: an entry marked draft`);
    for (const m of text.matchAll(/(?<![\w-])([\w-]+)\/drafts\//g)) leaks.push(`${key}: names ${m[1]}/drafts/`);
    for (const { route, slug } of drafts) {
      if (new RegExp(`(?<![\\w-])${escape(route)}/${escape(slug)}(?![\\w.-])|"slug":"${escape(slug)}"`).test(text)) {
        leaks.push(`${key}: has the draft ${route}/drafts/${slug}.org`);
      }
    }
  }
  if (leaks.length) {
    const shown = [...new Set(leaks)];
    fail(`${shown.length} draft leak(s) (a drafts/ folder reached the site; build it as CI does, DRAFTS=0 make build):\n  ${
      shown.slice(0, 12).join('\n  ')}${shown.length > 12 ? `\n  ...and ${shown.length - 12} more` : ''}`);
  }
}

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
  for (const m of text.matchAll(/\b(?:href|src|poster|data-hls)=\\?"([^"\\]*)\\?"/g)) note(key, m[1]);
  for (const m of text.matchAll(/"(?:hls|hlsjs)":"([^"]*)"/g)) note(key, m[1].replaceAll('\\/', '/'));
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
