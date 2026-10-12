// Is this tab running the site that is live? (2026-10-11, as in ../merecatholicity.com's
// nav.js)
//
// Every deploy names the script and styles by a hash of their contents (js/app.<hash>.js,
// site.<hash>.css), and scripts/dist.sh writes /version.json with those hashes. This
// compares it against the hashes THIS PAGE IS RUNNING, read off its own <script> and
// <link> addresses rather than a constant compiled in: a tab opened before a deploy
// carries the old names, and the addresses can't lie about that.
//
// It offers and never acts: a tab left open over a deploy gets a small "Reload" offer,
// never a reload out from under its reader, and never while they're typing in a form.

/** {app.js: hash, site.css: hash}, as the page's own addresses name them. */
function running() {
    const out: Record<string, string> = {};
    for (const el of document.querySelectorAll('script[src], link[href]')) {
        const m = /([^/?#]+)\.([0-9a-f]{10})\.(js|css)$/.exec(el.getAttribute('src') || el.getAttribute('href') || '');
        if (m) out[`${m[1]}.${m[3]}`] = m[2];
    }
    return out;
}

/** What this page carries that the server has moved on from; only files on both sides count. */
function behind(served: Record<string, string>) {
    const have = running();
    return Object.keys(have).filter(k => served[k] && served[k] !== have[k]);
}

function typing() {
    return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input[type=text], input[type=email]')]
        .some(el => el.value);
}

let bar: HTMLDivElement | null = null;
function offer(build: string) {
    try { if (sessionStorage.getItem('version-later') === build) return; } catch { /* private mode */ }
    if (bar || typing()) return;   // offered again at the next check
    bar = document.createElement('div');
    bar.className = 'fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg bg-mesa px-4 py-2.5 text-[.9rem] text-sand shadow-lg ring-1 ring-ridge phone:left-4 phone:bottom-[calc(5rem+env(safe-area-inset-bottom))]';
    bar.setAttribute('role', 'status');
    const msg = document.createElement('span');
    msg.textContent = 'A new version of the site is ready.';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'cursor-pointer rounded-md border-0 bg-turq px-3 py-1 [font-family:inherit] [font-size:inherit] font-semibold text-sky hover:bg-surf';
    go.textContent = 'Reload';
    go.onclick = () => location.reload();
    const later = document.createElement('button');
    later.type = 'button';
    later.className = 'cursor-pointer border-0 bg-transparent px-1 [font-family:inherit] [font-size:inherit] text-dust hover:text-sand';
    later.textContent = 'Later';
    later.onclick = () => {
        try { sessionStorage.setItem('version-later', build); } catch { /* private mode */ }
        bar?.remove();
        bar = null;
    };
    bar.append(msg, go, later);
    document.body.append(bar);
}

// no-store: whether a cache is stale is never a question to ask that cache.
function check() {
    return fetch('/version.json', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then((d: { build: string, assets: Record<string, string> } | null) => {
            if (d?.assets && behind(d.assets).length) offer(d.build);
        })
        .catch(() => {});   // offline: silence
}

/** On coming back to the tab, on a page restored from the back-forward cache, and hourly;
    never more than once in five minutes. version.json is a static asset: it costs no
    Worker request. */
export function watchVersion() {
    let last = 0;
    const paced = () => {
        if (Date.now() - last < 300000) return;
        last = Date.now();
        check();
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') paced(); });
    addEventListener('pageshow', e => { if (e.persisted) paced(); });
    setInterval(paced, 3600000);
    setTimeout(paced, 4000);
}
