#!/usr/bin/env node
// make build's first step: compile what the pages load, into build/ (git ignores it).
//
//   build/js/app.js    src/app.ts and everything it imports (lit-html from npm included), one
//                      module bundled by esbuild, minified, with its source map
//   build/site.css     src/site.css and the Tailwind utilities the templates use (src/, site.el),
//                      compiled by Tailwind's CLI, minified
//
// site.el then names each by a hash of its contents (js/app.<hash>.js, site.<hash>.css),
// writes the pages beside them, and scripts/dist.sh publishes it all as public/.
//
// And each Worker's admin page (site-worker's assets, license-worker's licenses): its script
// (src/admin-page.ts) and styles (src/admin-page.css), compiled the same way into
// src/admin-page.gen.ts (git ignores it too), which the Worker imports and inlines in the page.
// The Workers' tests, tsc and wrangler need those; `workers` makes only them.
//
//   node scripts/build.ts            everything (make build)
//   node scripts/build.ts site       the page's script and styles only (make run, on a change)
//   node scripts/build.ts workers    the admin pages only (make workers)

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const WORKERS = ['site-worker', 'license-worker'];
const ONLY = process.argv[2];

/** Tailwind's CLI on one stylesheet: the CSS, minified; its own output only when it fails. */
function tailwind(input: string) {
  try {
    return execFileSync(`${ROOT}node_modules/.bin/tailwindcss`, ['--input', input, '--minify'], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
  } catch (err) {
    process.stderr.write((err as { stderr?: string }).stderr ?? '');
    throw new Error(`build: tailwindcss failed on ${input}`);
  }
}

/** A Worker's admin page: its script, bundled into one function the page runs, and its styles,
    as two strings in src/admin-page.gen.ts. */
async function adminPage(worker: string) {
  const dir = `${worker}/src`;
  const { outputFiles } = await build({
    absWorkingDir: ROOT,
    entryPoints: [`${dir}/admin-page.ts`],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    write: false,
    logLevel: 'warning',
  });
  const script = outputFiles[0].text.trim();
  const style = tailwind(`${dir}/admin-page.css`).trim();
  // Both go inside the page's own <script> and <style>.
  if (/<\/script/i.test(script) || /<\/style/i.test(style)) throw new Error(`build: ${dir}'s admin page would close its own <script> or <style>`);
  writeFileSync(`${ROOT}${dir}/admin-page.gen.ts`, `// Written by scripts/build.ts (make build, make workers) from admin-page.ts and admin-page.css:
// the admin page's script and styles, which src/admin.ts inlines. Git ignores this file.
export const SCRIPT = ${JSON.stringify(script)};
export const STYLE = ${JSON.stringify(style)};
`);
  console.log(`build: ${dir}/admin-page.gen.ts`);
}

if (ONLY !== 'workers') {
  rmSync(`${ROOT}build`, { recursive: true, force: true });
  await build({
    absWorkingDir: ROOT,
    entryPoints: ['src/app.ts'],
    outfile: 'build/js/app.js',
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    sourcemap: 'linked',
    logLevel: 'warning',
  });
  console.log('build: build/js/app.js');
  mkdirSync(`${ROOT}build`, { recursive: true });
  writeFileSync(`${ROOT}build/site.css`, tailwind('src/site.css'));
  console.log('build: build/site.css');
}
if (ONLY !== 'site') for (const worker of WORKERS) await adminPage(worker);
