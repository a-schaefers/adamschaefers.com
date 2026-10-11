// The site is one page. The sidebar is static HTML from index.org; this renders the menu
// and one view at a time beside it from the #site-data JSON that site.el builds, so every
// view is already loaded and switching never loads a page. Views are hash routes:
//   #quest-log (the default)  #inquiries  #sitemap
//   #blog  #blog/2  #blog/<entry slug>, and the same under #off-the-clock
// Any other hash is left to the browser as a plain in-page anchor (footnotes, say).

import { html, render, nothing } from './lit/lit-html/lit-html.js';
import { unsafeHTML } from './lit/lit-html/directives/unsafe-html.js';
import { mountContactForms } from './contact.js';

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
    { route: 'inquiries', label: 'Contact', sections: ['inquiries'],
      icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>' },
];
const DEFAULT = 'quest-log';
const RSS_ICON = '<path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14"/><circle cx="6" cy="18" r="1.2"/>';

// The view for the current hash, or null when the hash isn't a route.
function parseRoute() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (!hash || hash === 'about' || hash === 'slop-shelf') return { tab: DEFAULT };
    if (hash === 'sitemap') return { tab: 'sitemap' };
    const [route, rest] = hash.split(/\/(.*)/s);
    const tab = TABS.find(t => t.route === route);
    if (!tab) return null;
    if (tab.sections) return rest === undefined ? { tab: route } : null;
    if (rest === undefined) return { tab: route, page: 1 };
    if (/^\d+$/.test(rest)) return { tab: route, page: Number(rest) };
    const i = collections[tab.collection].entries.findIndex(e => e.slug === rest);
    return i < 0 ? { tab: route, page: 1 } : { tab: route, entry: i };
}

const icon = paths => unsafeHTML(`<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`);

const menu = active => html`
    <div class="site-tabs">
        ${TABS.map(t => html`<a href="#${t.route}" aria-current=${t.route === active ? 'page' : nothing}>${icon(t.icon)}<span>${t.label}</span></a>`)}
    </div>`;

// An index.org section, wrapped the way Org exports it so index.org's styles apply.
const section = s => html`
    <div id="outline-container-${s.id}" class="outline-2">
        <h2>${s.title}</h2>
        <div class="outline-text-2" id="text-${s.id}">${unsafeHTML(s.html)}</div>
    </div>`;

const pageHref = (route, n) => n === 1 ? `#${route}` : `#${route}/${n}`;

// src on the element itself, not a <source>, so a reused element loads the new video.
const video = (e, cls) => html`
    <video controls playsinline preload="metadata" src=${e.video} poster=${e.poster || nothing} class=${cls || nothing}></video>`;

// A listing entry: a post's excerpt, or a travelog's video and caption.
const entry = (route, e) => e.video ? html`
    <li class="travelog">
        ${video(e)}
        <time datetime=${e.date}>${e.dateLabel}</time>
        <h3><a href="#${route}/${e.slug}">${e.title}</a></h3>
        ${unsafeHTML(e.excerpt)}
    </li>` : html`
    <li class="entry">
        <time datetime=${e.date}>${e.dateLabel}</time>
        <h3><a href="#${route}/${e.slug}">${e.title}</a></h3>
        ${unsafeHTML(e.excerpt)}
        <a class="entry-more" href="#${route}/${e.slug}">Read post →</a>
    </li>`;

function listing(route, c, page) {
    const pages = Math.max(1, Math.ceil(c.entries.length / c.perPage));
    page = Math.min(Math.max(page, 1), pages);
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
            ${newer ? html`<a class="newer" href="#${route}/${newer.slug}" rel="prev"><span>← Newer</span>${newer.title}</a>` : nothing}
            ${older ? html`<a class="older" href="#${route}/${older.slug}" rel="next"><span>Older →</span>${older.title}</a>` : nothing}
        </nav>
    </article>`;
}

// Every view and entry, for people; sitemap.xml is for crawlers.
const sitemap = () => html`
    <div class="outline-2 sitemap">
        <h2>Sitemap</h2>
        <ul>
            ${TABS.map(t => html`<li>
                <a href="#${t.route}">${t.label}</a>
                ${t.collection && collections[t.collection].entries.length ? html`<ul>
                    ${collections[t.collection].entries.map(e => html`<li><a href="#${t.route}/${e.slug}">${e.title}</a> <time datetime=${e.date}>${e.dateLabel}</time></li>`)}
                </ul>` : nothing}
            </li>`)}
        </ul>
        <h3>Feeds</h3>
        <ul>
            <li><a href=${data.feed}>RSS feed</a> (the blog and Off the clock)</li>
            <li><a href="sitemap.xml">sitemap.xml</a></li>
        </ul>
    </div>`;

function view(r) {
    if (r.tab === 'sitemap') return sitemap();
    const t = TABS.find(t => t.route === r.tab);
    if (t.collection) {
        const c = collections[t.collection];
        return r.entry === undefined ? listing(t.route, c, r.page) : single(t.route, t.label, c, r.entry);
    }
    return t.sections.map(id => section(sections[id]));
}

function title(r) {
    if (r.tab === DEFAULT) return SITE;
    if (r.tab === 'sitemap') return `Sitemap · ${SITE}`;
    const t = TABS.find(t => t.route === r.tab);
    if (r.entry !== undefined) return `${collections[t.collection].entries[r.entry].title} · ${SITE}`;
    return `${t.label} · ${SITE}`;
}

const nav = document.getElementById('site-nav');
const app = document.getElementById('app');
let shown = false;

function show() {
    const r = parseRoute() || (shown ? null : { tab: DEFAULT });
    if (!r) return;
    render(menu(r.tab), nav);
    render(view(r), app);
    mountContactForms(app);
    document.title = title(r);
    // A new view starts at the top of the page.
    if (shown) scrollTo({ top: 0, behavior: 'instant' });
    shown = true;
}

// Phones: tapping the highlighted button for the page you're on jumps back to the top.
const phone = matchMedia('(max-width: 56rem)');
nav.addEventListener('click', e => {
    if (phone.matches && e.target.closest('a[aria-current]')) {
        e.preventDefault();
        scrollTo({ top: 0, behavior: 'instant' });
    }
});

document.getElementById('year').textContent = new Date().getFullYear();
addEventListener('hashchange', show);
show();
