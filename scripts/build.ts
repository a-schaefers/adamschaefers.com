#!/usr/bin/env node
// make build's first step: compile what the pages load, into build/ (git ignores it).
//
//   build/js/app.js    js/app.ts and everything it imports (lit-html from npm included), one
//                      module bundled by esbuild, minified, with its source map
//
// site.el then names each by a hash of its contents (js/app.<hash>.js), and scripts/dist.sh
// publishes it under that name.
//
//   node scripts/build.ts

import { build } from 'esbuild';
import { rmSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}build`;

rmSync(OUT, { recursive: true, force: true });

await build({
  absWorkingDir: ROOT,
  entryPoints: ['js/app.ts'],
  outfile: 'build/js/app.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: 'linked',
  logLevel: 'warning',
});
console.log('build: build/js/app.js');
