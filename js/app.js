// The site is one page. The sidebar is static HTML from index.org; this renders the menu
// and one view at a time beside it from the #site-data JSON that site.el builds, so every
// view is already loaded and switching never loads a page. Each view has its own address,
// where site.el writes the same page with that view's link preview, so the address bar
// always holds a link that shares as the view on screen:
//   / (Projects)  /store/  /inquiries/  /sitemap/  /backseat-driver/ (its product in the store)
//   /privacy-policy/  /terms-of-service/ (linked from the footer)
//   /blog/  /blog/2/  /blog/<entry slug>/, and the same under /off-the-clock/
//   /#license/<Stripe checkout id>, where Stripe sends a license buyer back (private: no page)
// Links to a view switch to it here. A view's old hash route (/#store, still in links out
// there) shows it and gives way to its address; any other hash is a plain in-page anchor
// (footnotes, say).

import { html, render, nothing } from './lit/lit-html/lit-html.js';
import { unsafeHTML } from './lit/lit-html/directives/unsafe-html.js';
import { mountContactForms } from './contact.js';
import { mountStore, mountLicense } from './store.js';

const SITE = 'Adam Schaefers';
const data = JSON.parse(document.getElementById('site-data').textContent);
const sections = Object.fromEntries(data.views.map(v => [v.id, v]));
// Collections (blog.org and blog/, off-the-clock.org and off-the-clock/): dated entries,
// newest first, listed a page at a time. An entry with a video is shown as that video.
// One RSS feed (data.feed) carries every collection.
const collections = data.collections;

// Menu tabs: the route each opens, what it shows (index.org sections by CUSTOM_ID, or a
// collection by name), and its tab bar icon (24x24, drawn with currentColor).
const TABS = [
    { route: 'quest-log', label: 'Projects', sections: ['about', 'quest-log', 'slop-shelf'],
      icon: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>' },
    { route: 'blog', label: 'Blog', collection: 'blog',
      icon: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h6M8 11h6"/>' },
    { route: 'off-the-clock', label: 'Off the clock', collection: 'off-the-clock',
      icon: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>' },
    { route: 'store', label: 'Store', sections: ['store'],
      icon: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>' },
    { route: 'inquiries', label: 'Contact', sections: ['inquiries'],
      icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>' },
];
// Views that aren't in the menu; while one is open, the tab it hangs off is highlighted. A
// product's route shows the store at that product (its <article id="product-<route>">).
const PAGES = [
    { route: 'backseat-driver', label: 'Backseat Driver commercial license', sections: ['store'], under: 'store', product: true },
    { route: 'privacy-policy', label: 'Privacy policy', sections: ['privacy-policy'] },
    { route: 'terms-of-service', label: 'Terms of service', sections: ['terms-of-service'] },
];
const DEFAULT = 'quest-log';
const RSS_ICON = '<path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14"/><circle cx="6" cy="18" r="1.2"/>';

const findView = route => TABS.find(t => t.route === route) || PAGES.find(p => p.route === route);
const pageCount = c => Math.max(1, Math.ceil(c.entries.length / c.perPage));

// The view a route names ('store', 'blog/2', 'blog/<entry slug>', '' for the home page), or
// null when it names none.
function parse(route) {
    if (!route || route === 'about' || route === 'slop-shelf') return { tab: DEFAULT };
    if (route === 'sitemap') return { tab: 'sitemap' };
    const [name, rest] = route.split(/\/(.*)/s);
    if (name === 'license' && rest) return { tab: 'license', session: rest };
    const tab = findView(name);
    if (!tab) return null;
    if (tab.sections) return rest === undefined ? { tab: name } : null;
    const c = collections[tab.collection];
    if (rest === undefined) return { tab: name, page: 1 };
    if (/^\d+$/.test(rest)) return { tab: name, page: Math.min(Math.max(Number(rest), 1), pageCount(c)) };
    const i = c.entries.findIndex(e => e.slug === rest);
    return i < 0 ? { tab: name, page: 1 } : { tab: name, entry: i };
}

function decode(s) {
    try {
        return decodeURIComponent(s);
    } catch {
        // A malformed % sequence (a half-copied link): take it as typed.
        return s;
    }
}

// A view's address, where site.el writes its page: /, /store/, /blog/2/, /blog/<slug>/.
const address = (route, rest) => route === DEFAULT ? '/' : `/${route}/${rest ? `${rest}/` : ''}`;
const pageHref = (route, n) => address(route, n > 1 ? n : '');

function addressOf(r) {
    if (r.tab === 'license') return `/#license/${r.session}`;
    if (r.entry !== undefined) return address(r.tab, collections[findView(r.tab).collection].entries[r.entry].slug);
    return pageHref(r.tab, r.page || 1);
}

// The view a URL names: an old hash route (/#store) or Stripe's /#license/..., else the
// path. Exactly: only a view's own address, so a link to a file (/blog/photo.jpg) stays one.
function routeAt(url, exactly) {
    const hash = decode(url.hash.slice(1));
    const fromHash = hash && parse(hash);
    if (fromHash) return { ...fromHash, hash: true };
    const r = parse(decode(url.pathname).replace(/^\/+|\/+$/g, ''));
    return r && (!exactly || addressOf(r) === url.pathname) ? r : null;
}

const icon = paths => unsafeHTML(`<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`);

const menu = active => html`
    <div class="site-tabs">
        ${TABS.map(t => html`<a href=${address(t.route)} aria-current=${t.route === active ? 'page' : nothing}>${icon(t.icon)}<span>${t.label}</span></a>`)}
    </div>`;

// An index.org section, wrapped the way Org exports it so index.org's styles apply.
const section = s => html`
    <div id="outline-container-${s.id}" class="outline-2">
        <h2>${s.title}</h2>
        <div class="outline-text-2" id="text-${s.id}">${unsafeHTML(s.html)}</div>
    </div>`;

// src on the element itself, not a <source>, so a reused element loads the new video.
const video = (e, cls) => html`
    <video controls playsinline preload="metadata" src=${e.video} poster=${e.poster || nothing} class=${cls || nothing}></video>`;

// A listing entry: a post's excerpt, or a travelog's video and caption.
const entry = (route, e) => e.video ? html`
    <li class="travelog">
        ${video(e)}
        <time datetime=${e.date}>${e.dateLabel}</time>
        <h3><a href=${address(route, e.slug)}>${e.title}</a></h3>
        ${unsafeHTML(e.excerpt)}
    </li>` : html`
    <li class="entry">
        <time datetime=${e.date}>${e.dateLabel}</time>
        <h3><a href=${address(route, e.slug)}>${e.title}</a></h3>
        ${unsafeHTML(e.excerpt)}
        <a class="entry-more" href=${address(route, e.slug)}>Read post →</a>
    </li>`;

function listing(route, c, page) {
    const pages = pageCount(c);
    const shown = c.entries.slice((page - 1) * c.perPage, page * c.perPage);
    return html`
    <div class="outline-2 blog">
        <h2>${c.title}</h2>
        ${unsafeHTML(c.intro)}
        <p class="blog-rss"><a href=${data.feed}>${icon(RSS_ICON)}RSS feed</a></p>
        ${shown.length
            ? html`<ol class=${shown.some(e => e.video) ? 'travelogs' : 'entries'}>${shown.map(e => entry(route, e))}</ol>`
            : html`<div class="entries-empty">
                <p class="entries-empty-title">Nothing here yet.</p>
                <p>Watch this space. The RSS feed will tell you when the first post lands.</p>
              </div>`}
        ${pages > 1 ? html`
        <nav class="pager" aria-label="Pages">
            ${page > 1 ? html`<a href=${pageHref(route, page - 1)} rel="prev">← Newer</a>` : html`<span></span>`}
            <span class="pager-count">Page ${page} of ${pages}</span>
            ${page < pages ? html`<a href=${pageHref(route, page + 1)} rel="next">Older →</a>` : html`<span></span>`}
        </nav>` : nothing}
    </div>`;
}

function single(route, label, c, i) {
    const e = c.entries[i], newer = c.entries[i - 1], older = c.entries[i + 1];
    return html`
    <article class="outline-2 post">
        <header class="post-head">
            <a class="post-back" href=${pageHref(route, Math.floor(i / c.perPage) + 1)}>← ${label}</a>
            <h2>${e.title}</h2>
            <time datetime=${e.date}>${e.dateLabel}</time>
        </header>
        ${e.video ? video(e, 'post-video') : nothing}
        ${unsafeHTML(e.html)}
        <nav class="post-nav" aria-label="More">
            ${newer ? html`<a class="newer" href=${address(route, newer.slug)} rel="prev"><span>← Newer</span>${newer.title}</a>` : nothing}
            ${older ? html`<a class="older" href=${address(route, older.slug)} rel="next"><span>Older →</span>${older.title}</a>` : nothing}
        </nav>
    </article>`;
}

// Every view and entry, for people; sitemap.xml is for crawlers.
const sitemap = () => html`
    <div class="outline-2 sitemap">
        <h2>Sitemap</h2>
        <ul>
            ${TABS.map(t => html`<li>
                <a href=${address(t.route)}>${t.label}</a>
                ${t.collection && collections[t.collection].entries.length ? html`<ul>
                    ${collections[t.collection].entries.map(e => html`<li><a href=${address(t.route, e.slug)}>${e.title}</a> <time datetime=${e.date}>${e.dateLabel}</time></li>`)}
                </ul>` : nothing}
            </li>`)}
            ${PAGES.map(p => html`<li><a href=${address(p.route)}>${p.label}</a></li>`)}
        </ul>
        <h3>Feeds</h3>
        <ul>
            <li><a href=${data.feed}>RSS feed</a> (the blog and Off the clock)</li>
            <li><a href="sitemap.xml">sitemap.xml</a></li>
        </ul>
    </div>`;

// Where Stripe sends a license buyer back; js/buy.js fills in the key.
const license = session => html`
    <div class="outline-2 license">
        <h2>Thank you!</h2>
        <div id="license-mount" data-session=${session}></div>
    </div>`;

function view(r) {
    if (r.tab === 'sitemap') return sitemap();
    if (r.tab === 'license') return license(r.session);
    const t = findView(r.tab);
    if (t.collection) {
        const c = collections[t.collection];
        return r.entry === undefined ? listing(t.route, c, r.page) : single(t.route, t.label, c, r.entry);
    }
    return t.sections.map(id => section(sections[id]));
}

function title(r) {
    if (r.tab === DEFAULT) return SITE;
    if (r.tab === 'sitemap') return `Sitemap · ${SITE}`;
    if (r.tab === 'license') return `Your license key · ${SITE}`;
    const t = findView(r.tab);
    if (r.entry !== undefined) return `${collections[t.collection].entries[r.entry].title} · ${SITE}`;
    if (r.page > 1) return `${t.label}, page ${r.page} · ${SITE}`;
    return `${t.label} · ${SITE}`;
}

const nav = document.getElementById('site-nav');
const app = document.getElementById('app');
let shown = null; // the address of the view on screen

// A new view starts at the top of the page, or at its product.
function toStart(r, first) {
    const product = PAGES.find(p => p.route === r.tab && p.product) && document.getElementById(`product-${r.tab}`);
    if (product) product.scrollIntoView({ behavior: 'instant', block: 'start' });
    else if (!first) scrollTo({ top: 0, behavior: 'instant' });
}

// Show the view the address bar names, and put its address there in place of an old hash
// route or a path that names no view (404.html: the nearest view, or the home page). An
// in-page anchor and a query (?fbclid=...) stay.
function show() {
    const r = routeAt(location) || { tab: DEFAULT };
    const at = addressOf(r);
    const want = r.hash ? at : at + location.hash;
    if (location.pathname + location.hash !== want) {
        history.replaceState(history.state, '', want.replace(/#|$/, `${location.search}$&`));
    }
    if (at === shown) return;
    render(menu(PAGES.find(p => p.route === r.tab)?.under || r.tab), nav);
    render(view(r), app);
    mountContactForms(app);
    mountStore(app);
    mountLicense(app);
    document.title = title(r);
    toStart(r, !shown);
    shown = at;
}

// Where a link goes, if to a view: its route, else null (a file, another site, an anchor).
function linkRoute(a) {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) return href.length > 1 ? parse(decode(href.slice(1))) : null;
    const url = new URL(href, document.baseURI);
    return url.origin === location.origin ? routeAt(url, true) : null;
}

// A link to a view switches to it here, without loading a page; one to the view on screen
// goes back to its start. The page has <base href="/"> (site.el), which would send a bare
// #anchor to the home page, so those are followed here on the page they're on.
document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
        || a.target || a.hasAttribute('download')) return;
    const r = linkRoute(a);
    if (r) {
        e.preventDefault();
        const at = addressOf(r);
        if (location.pathname + location.hash !== at) history.pushState(null, '', at);
        if (at === shown) toStart(r);
        else show();
    } else if (a.getAttribute('href').startsWith('#')) {
        e.preventDefault();
        location.hash = a.getAttribute('href');
    }
});

// Phones: tapping the highlighted button for the page you're on jumps back to the top.
const phone = matchMedia('(max-width: 56rem)');
nav.addEventListener('click', e => {
    if (phone.matches && e.target.closest('a[aria-current]')) {
        e.preventDefault();
        scrollTo({ top: 0, behavior: 'instant' });
    }
});

document.getElementById('year').textContent = new Date().getFullYear();
addEventListener('popstate', show);
addEventListener('hashchange', show);
show();
