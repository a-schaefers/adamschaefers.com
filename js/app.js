// The site is one page. The sidebar is static HTML from index.org; this renders the menu
// and one view at a time beside it from the #site-data JSON that site.el builds, so every
// view is already loaded and switching never loads a page. Views are hash routes:
//   #quest-log (the default)  #off-the-clock  #inquiries
//   #blog  #blog/2  #blog/<post slug>
// Any other hash is left to the browser as a plain in-page anchor (footnotes, say).

import { html, render, nothing } from './lit/lit-html/lit-html.js';
import { unsafeHTML } from './lit/lit-html/directives/unsafe-html.js';
import { mountContactForms } from './contact.js';

const SITE = 'Adam Schaefers';
const data = JSON.parse(document.getElementById('site-data').textContent);
const sections = Object.fromEntries(data.views.map(v => [v.id, v]));
const posts = data.posts;

// Menu tabs: the route each opens, the index.org sections it shows (by CUSTOM_ID), and
// its tab bar icon (24x24, drawn with currentColor).
const TABS = [
    { route: 'quest-log', label: 'Projects', sections: ['about', 'quest-log', 'slop-shelf'],
      icon: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>' },
    { route: 'blog', label: 'Blog',
      icon: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h6M8 11h6"/>' },
    { route: 'off-the-clock', label: 'Off the clock', sections: ['off-the-clock'],
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
    if (hash === 'blog') return { tab: 'blog', page: 1 };
    if (hash.startsWith('blog/')) {
        const rest = hash.slice('blog/'.length);
        if (/^\d+$/.test(rest)) return { tab: 'blog', page: Number(rest) };
        const i = posts.findIndex(p => p.slug === rest);
        return i < 0 ? { tab: 'blog', page: 1 } : { tab: 'blog', post: i };
    }
    return TABS.some(t => t.sections && t.route === hash) ? { tab: hash } : null;
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

const pageHref = n => n === 1 ? '#blog' : `#blog/${n}`;

const entry = p => html`
    <li class="entry">
        <time datetime=${p.date}>${p.dateLabel}</time>
        <h3><a href="#blog/${p.slug}">${p.title}</a></h3>
        ${unsafeHTML(p.excerpt)}
        <a class="entry-more" href="#blog/${p.slug}">Read post →</a>
    </li>`;

function blogPage(page) {
    const per = data.blog.perPage;
    const pages = Math.max(1, Math.ceil(posts.length / per));
    page = Math.min(Math.max(page, 1), pages);
    const shown = posts.slice((page - 1) * per, page * per);
    return html`
    <div class="outline-2 blog">
        <h2>${data.blog.title}</h2>
        ${unsafeHTML(data.blog.intro)}
        <p class="blog-rss"><a href="rss.xml">${icon(RSS_ICON)}RSS feed</a></p>
        ${shown.length
            ? html`<ol class="entries">${shown.map(entry)}</ol>`
            : html`<div class="entries-empty">
                <p class="entries-empty-title">Nothing here yet.</p>
                <p>Watch this space. The RSS feed will tell you when the first post lands.</p>
              </div>`}
        ${pages > 1 ? html`
        <nav class="pager" aria-label="Blog pages">
            ${page > 1 ? html`<a href=${pageHref(page - 1)} rel="prev">← Newer</a>` : html`<span></span>`}
            <span class="pager-count">Page ${page} of ${pages}</span>
            ${page < pages ? html`<a href=${pageHref(page + 1)} rel="next">Older →</a>` : html`<span></span>`}
        </nav>` : nothing}
    </div>`;
}

function post(i) {
    const p = posts[i], newer = posts[i - 1], older = posts[i + 1];
    return html`
    <article class="outline-2 post">
        <header class="post-head">
            <a class="post-back" href=${pageHref(Math.floor(i / data.blog.perPage) + 1)}>← Blog</a>
            <h2>${p.title}</h2>
            <time datetime=${p.date}>${p.dateLabel}</time>
        </header>
        ${unsafeHTML(p.html)}
        <nav class="post-nav" aria-label="More posts">
            ${newer ? html`<a class="newer" href="#blog/${newer.slug}" rel="prev"><span>← Newer post</span>${newer.title}</a>` : nothing}
            ${older ? html`<a class="older" href="#blog/${older.slug}" rel="next"><span>Older post →</span>${older.title}</a>` : nothing}
        </nav>
    </article>`;
}

function view(r) {
    if (r.tab === 'blog') return r.post === undefined ? blogPage(r.page) : post(r.post);
    return TABS.find(t => t.route === r.tab).sections.map(id => section(sections[id]));
}

function title(r) {
    if (r.post !== undefined) return `${posts[r.post].title} · ${SITE}`;
    if (r.tab === DEFAULT) return SITE;
    return `${TABS.find(t => t.route === r.tab).label} · ${SITE}`;
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

document.getElementById('year').textContent = new Date().getFullYear();
addEventListener('hashchange', show);
show();
