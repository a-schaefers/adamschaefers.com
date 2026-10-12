// The rules of src/version.ts, the "a new version of the site is ready" offer (as
// ../merecatholicity.com's tests/js/version_check.test.ts holds its nav.js to them), and of
// the version.json scripts/dist.sh writes for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const src = read('src/version.ts');

test('it compares what the page LOADED, not a version compiled in', () => {
  assert.match(src, /document\.querySelectorAll\('script\[src\], link\[href\]'\)/);
  assert.doesNotMatch(src, /BUILD_ID|__BUILD__/);
});

test('whether it is current is never answered from a cache', () => {
  assert.match(src, /fetch\('\/version\.json', \{ cache: 'no-store' \}\)/);
});

test('only files the page carries are judged', () => {
  assert.match(src, /served\[k\] && served\[k\] !== have\[k\]/);
});

test('it offers and never acts: the one reload is the button', () => {
  assert.equal(src.match(/location\.reload\(\)/g)?.length, 1);
  assert.match(src, /go\.onclick = \(\) => location\.reload\(\);/);
});

test('never over a half-written message', () => {
  assert.match(src, /if \(bar \|\| typing\(\)\) return;/);
});

test('app.ts starts it', () => {
  assert.match(read('src/app.ts'), /^watchVersion\(\);$/m);
});

test('version.json revalidates: the default rule, never a hashed one', () => {
  assert.doesNotMatch(read('site-worker/_headers'), /version\.json/);
});
