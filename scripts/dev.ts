#!/usr/bin/env node
// make run: the site at http://localhost:8000 (PORT), served the way the site serves it,
// rebuilt as its sources change, and every open page reloaded once the change is served.
//
// It builds everything once (make build's three steps), then runs wrangler dev on public/
// (Workers Static Assets, so 404.html, _headers and _redirects too) on a free port of its
// own, and answers PORT itself: each request goes to wrangler, and a page (HTML) comes back
// with a small script that keeps a WebSocket open to /__dev. A save in
//
//   content/                 the Org export again, then dist (dist only for a non-Org file)
//   src/, site.el            the script and styles too (Tailwind reads both for classes)
//   static/, site-worker/_headers, _redirects     dist only
//   site-worker/src/admin-page.*                  the admin page (wrangler reloads the Worker)
//
// reruns just those steps (a draft, under content/*/drafts/, like any entry); once wrangler serves the new index.html, the socket says
// "reload". A failed build sends its error instead, shown over the page until the next
// build works. None of this reaches the site: the script exists only in this proxy's
// answers, never in build/ or public/.
//
//   node scripts/dev.ts            PORT overrides 8000

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { createServer, request, type IncomingMessage } from 'node:http';
import { createServer as createNetServer, type Socket } from 'node:net';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8000);
const SOCKET = '/__dev';
// The drafts are always in (site.el's site--drafts-p), whatever DRAFTS the shell has.
process.env.DRAFTS = '1';

type Step = 'site' | 'workers' | 'org' | 'dist';
const STEPS: Record<Step, [string, string[]]> = {
  site: ['node', ['scripts/build.ts', 'site']],
  workers: ['node', ['scripts/build.ts', 'workers']],
  org: ['emacs', ['-Q', '--batch', '-l', 'site.el', '-f', 'site-build']],
  dist: ['sh', ['scripts/dist.sh']],
};
const ORDER: Step[] = ['site', 'workers', 'org', 'dist'];

/** The steps a change to FILE (relative to the repository) needs, or none. */
function stepsFor(file: string): Step[] {
  const name = file.split('/').pop() ?? '';
  // Editors' lock files, backups and autosaves.
  if (/^\.#|^#.*#$|~$|^\.?flycheck_|\.swp$/.test(name)) return [];
  if (file.startsWith('src/') || file === 'site.el') return ['site', 'org', 'dist'];
  if (file.startsWith('content/')) return file.endsWith('.org') ? ['org', 'dist'] : ['dist'];
  if (file.startsWith('static/') || file === 'site-worker/_headers' || file === 'site-worker/_redirects') return ['dist'];
  if (/^site-worker\/src\/admin-page\.(ts|css)$/.test(file)) return ['workers'];
  return [];
}

/** The Org export runs in an Emacs kept for it (site.el's site-build-loop, a build for each
    line it reads): a new Emacs spends most of a build starting up and loading Org, so a save
    shows a second or so sooner. Each build starts afresh all the same, and a change to
    site.el gets a new Emacs. One that dies is started again at the next build. */
type Emacs = { child: ChildProcess; site: number; output: string; done?: (error?: string) => void };
let emacs: Emacs | undefined;

function exportOrg(): Promise<string> {
  const site = statSync(`${ROOT}site.el`).mtimeMs;
  if (emacs && emacs.site !== site) { emacs.child.kill(); emacs = undefined; }
  if (!emacs) {
    const child = spawn('emacs', ['-Q', '--batch', '-l', 'site.el', '-f', 'site-build-loop'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    const e: Emacs = { child, site, output: '' };
    for (const stream of [child.stdout, child.stderr]) {
      let rest = '';
      stream.on('data', (d: Buffer) => {
        const lines = (rest + d).split('\n');
        rest = lines.pop() ?? '';
        for (const line of lines) {
          if (line === 'site: built') { e.done?.(); continue; }
          e.output += `${line}\n`;
          process.stderr.write(`${line}\n`);
          if (line.startsWith('site: failed: ')) e.done?.(line);
        }
      });
    }
    const gone = (why: string) => { if (emacs === e) emacs = undefined; e.done?.(why); };
    child.on('error', (err) => gone(err.message));
    child.on('exit', (code) => gone(`emacs exited (${code})`));
    child.stdin.on('error', () => { /* it exited; 'exit' says so */ });
    emacs = e;
  }
  const e = emacs;
  return new Promise((resolve, reject) => {
    e.output = '';
    e.done = (error) => {
      e.done = undefined;
      if (error) reject(new Error(`${STEPS.org.flat().join(' ')} failed:\n${e.output.trim() || error}`));
      else resolve(e.output);
    };
    e.child.stdin!.write('\n');
  });
}

const runStep = (step: Step) => (step === 'org' ? exportOrg() : run(STEPS[step]));

function run([cmd, args]: [string, string[]]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { output += d; process.stderr.write(d); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(`${cmd} ${args.join(' ')} failed:\n${output.trim()}`))));
  });
}

// The build: one at a time; changes during one are built next, all together.
const pending = new Set<Step>();
let building = false;
let failed = '';

async function build() {
  if (building || !pending.size) return;
  building = true;
  const steps = ORDER.filter((s) => pending.has(s));
  pending.clear();
  const started = Date.now();
  try {
    const before = snapshot();
    for (const step of steps) await runStep(step);
    failed = '';
    const after = snapshot();
    await served([...after.keys()].filter((f) => after.get(f) !== before.get(f)));
    console.log(`dev: built (${steps.join(', ')}) in ${((Date.now() - started) / 1000).toFixed(1)}s, reloading ${clients.size} page(s)`);
    broadcast({ reload: true });
  } catch (err) {
    failed = (err as Error).message;
    console.error(`dev: ${failed.split('\n')[0]}`);
    broadcast({ error: failed });
  }
  building = false;
  if (pending.size) build();
}

let timer: NodeJS.Timeout | undefined;
function changed(file: string) {
  const steps = stepsFor(file);
  if (!steps.length) return;
  for (const s of steps) pending.add(s);
  clearTimeout(timer);
  // A save is often several events (a backup, a rename, the write): build once, after them.
  timer = setTimeout(build, 150);
}

/** DIR (relative to the repository) and every folder in it, each folder watched itself.
    Not watch(DIR, { recursive: true }): on Linux Node follows each file by its inode, and
    loses one that a save replaces (Emacs renames the old file to file~ and writes a new
    one), so after a save or two its changes went unseen. A folder's own watch names any
    file in it that changes, however it was saved. */
const folders = new Map<string, { ino: number; watcher: FSWatcher }>();
function watchTree(dir: string) {
  let ino: number;
  try { ino = statSync(`${ROOT}${dir}`).ino; } catch { return; }
  const known = folders.get(dir);
  if (known?.ino === ino) return;
  known?.watcher.close(); // a folder deleted and made again
  const watcher = watch(`${ROOT}${dir}`, (_, name) => {
    if (!name) return;
    const file = `${dir}/${name}`;
    try { if (statSync(`${ROOT}${file}`).isDirectory()) watchTree(file); } catch { /* gone */ }
    changed(file);
  });
  watcher.on('error', () => { watcher.close(); folders.delete(dir); });
  folders.set(dir, { ino, watcher });
  for (const entry of readdirSync(`${ROOT}${dir}`, { withFileTypes: true })) {
    if (entry.isDirectory()) watchTree(`${dir}/${entry.name}`);
  }
}

/** public/'s files, each with its size and time (dist.sh copies only what changed). */
function snapshot(dir = `${ROOT}public`, prefix = '', files = new Map<string, string>()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) snapshot(path, `${prefix}${entry.name}/`, files);
    else { const { size, mtimeMs } = statSync(path); files.set(`${prefix}${entry.name}`, `${size} ${mtimeMs}`); }
  }
  return files;
}

/** Until wrangler serves each of FILES (in public/) as it is on disk, at most a few seconds.
    It reads a changed file at once, but learns of a new one (a new script's hashed name, a
    new entry's page) only once it has noticed public/ change. */
async function served(files: string[]) {
  let left = files.filter((f) => f !== '404.html' && !f.startsWith('_'));
  const address = (f: string) => `/${f.replace(/(^|\/)index\.html$/, '$1')}`;
  for (const f of left) probing.add(address(f));
  for (let i = 0; i < 50 && left.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, 100));
    const ok = await Promise.all(left.map(async (f) => {
      const got = await fetch(`http://127.0.0.1:${upstream}${address(f)}`).then((r) => r.ok ? r.arrayBuffer() : null, () => null);
      return got !== null && readFileSync(`${ROOT}public/${f}`).equals(Buffer.from(got));
    }));
    left = left.filter((_, j) => !ok[j]);
  }
  setTimeout(() => probing.clear(), 1000); // wrangler logs a request after answering it
}
/** The addresses served() is asking for, whose lines are kept out of wrangler's log. */
const probing = new Set<string>();

// The open pages' sockets, and just enough of WebSocket (RFC 6455) to send them a message.
const clients = new Set<Socket>();

function frame(text: string) {
  const data = Buffer.from(text);
  const n = data.length;
  const head = n < 126 ? Buffer.from([0x81, n])
    : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, data]);
}

function broadcast(message: object) {
  const f = frame(JSON.stringify(message));
  for (const socket of clients) socket.write(f);
}

// What each page gets: the socket, a reload when told (or when make run comes back after a
// restart), and a build's error over the page.
const CLIENT = `<script>/* make run (scripts/dev.ts): not on the site */
(() => {
  let open = false;
  const connect = () => {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '${SOCKET}');
    ws.onopen = () => { if (open === null) location.reload(); open = true; };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.reload) location.reload();
      let box = document.getElementById('dev-error');
      if (m.error) {
        if (!box) {
          box = document.createElement('pre');
          box.id = 'dev-error';
          box.style.cssText = 'position:fixed;inset:auto 1rem 1rem 1rem;z-index:2147483647;max-height:50vh;overflow:auto;margin:0;padding:1rem;background:#300;color:#fdd;font:12px/1.4 monospace;white-space:pre-wrap;border-radius:6px;box-shadow:0 4px 24px #0008';
          box.onclick = () => box.remove();
          document.body.append(box);
        }
        box.textContent = 'Build failed (make run; click to hide)\\n\\n' + m.error;
      }
    };
    ws.onclose = () => { if (open) open = null; setTimeout(connect, 1000); };
  };
  connect();
})();
</script>`;

/** The page with the client script before its </body> (or at its end). */
function inject(html: string) {
  const at = html.lastIndexOf('</body>');
  return at < 0 ? html + CLIENT : html.slice(0, at) + CLIENT + html.slice(at);
}

let upstream = 0;
let serving = false; // once wrangler answers
let wrangler: ChildProcess | undefined;

const server = createServer((req, res) => {
  if (!serving) {
    res.writeHead(503, { 'content-type': 'text/plain', 'retry-after': '2' });
    res.end('make run: still building, reload in a moment\n');
    return;
  }
  const headers = { ...req.headers };
  delete headers['accept-encoding']; // plain bodies, so pages can take the script
  const up = request({ host: '127.0.0.1', port: upstream, method: req.method, path: req.url, headers }, (answer: IncomingMessage) => {
    if (req.method !== 'GET' || answer.statusCode === 304 || !/^text\/html/.test(answer.headers['content-type'] ?? '')) {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
      return;
    }
    const chunks: Buffer[] = [];
    answer.on('data', (c) => chunks.push(c));
    answer.on('end', () => {
      const body = Buffer.from(inject(Buffer.concat(chunks).toString('utf8')));
      const out = { ...answer.headers, 'content-length': String(body.length) };
      delete out['transfer-encoding'];
      res.writeHead(answer.statusCode ?? 502, out);
      res.end(body);
    });
  });
  up.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`make run: wrangler dev didn't answer (${err.message})\n`);
  });
  req.pipe(up);
});

server.on('upgrade', (req, socket: Socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url !== SOCKET || !key) return socket.destroy();
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  clients.add(socket);
  if (failed) socket.write(frame(JSON.stringify({ error: failed })));
  // Pages send nothing but a close, which ends it.
  socket.on('data', (d: Buffer) => { if ((d[0] & 0x0f) === 0x8) socket.end(); });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

/** A port nothing listens on, for wrangler. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    }).on('error', reject);
  });
}

function stop(code = 0) {
  process.exit(code);
}
// However this ends, Emacs, wrangler and its workerd processes (the group it leads) end with it.
process.on('exit', () => { emacs?.child.kill(); if (wrangler?.pid) try { process.kill(-wrangler.pid, 'SIGTERM'); } catch { /* gone */ } });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
process.on('uncaughtException', (err) => { console.error(err); stop(1); });

// PORT first, so a make run already serving it is said before anything is built.
await new Promise<void>((resolve) => {
  server.once('error', (err: NodeJS.ErrnoException) => {
    console.error(err.code === 'EADDRINUSE'
      ? `dev: port ${PORT} is taken (another make run? stop it, or PORT=8001 make run)`
      : `dev: can't listen on port ${PORT}: ${err.message}`);
    stop(1);
  });
  server.listen(PORT, resolve);
});

// Built once, all of it, before anything is served.
try {
  for (const step of ORDER) await runStep(step);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

upstream = await freePort();
wrangler = spawn(`${ROOT}node_modules/.bin/wrangler`,
  ['dev', '-c', 'site-worker/wrangler.jsonc', '--ip', '127.0.0.1', '--port', String(upstream), '--show-interactive-dev-session=false'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let ready: () => void;
const up = new Promise<void>((r) => { ready = r; });
for (const stream of [wrangler.stdout!, wrangler.stderr!]) {
  let rest = '';
  stream.on('data', (d) => {
    const lines = (rest + d).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) {
      // Its own address is this proxy's business; PORT is the one to open.
      if (line.includes(`:${upstream}`)) { if (/Ready on/.test(line)) ready(); continue; }
      if (probing.has(line.match(/^\[wrangler:info\] GET (\S+) /)?.[1] ?? '')) continue;
      console.log(line);
    }
  });
}
wrangler.on('exit', (code) => { console.error(`dev: wrangler dev exited (${code})`); stop(1); });
await up;
serving = true;

console.log(`\ndev: http://localhost:${PORT}/ (rebuilds on save, reloads open pages; Ctrl-C stops)\n`);

for (const dir of ['content', 'src', 'static']) watchTree(dir);
// The folders, not the files: an editor that saves by renaming would leave a file's watch behind.
watch(ROOT, (_, file) => file && changed(String(file)));
watch(`${ROOT}site-worker`, (_, file) => file && changed(`site-worker/${file}`));
watch(`${ROOT}site-worker/src`, (_, file) => file && changed(`site-worker/src/${file}`));
