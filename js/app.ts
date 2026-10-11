// The site is one page. The sidebar and the menu are static HTML (index.org, site.el);
// this marks the open tab and renders one view at a time beside them from the #site-data
// JSON that site.el builds, so every view is already loaded and switching never loads a
// page. Each view has its own address, where site.el writes the same page with that
// view's link preview (and the view itself drawn, so it shows before this script runs),
// so the address bar always holds a link that shares as the view on screen:
//   / (Projects)  /store/  /store/backseat-driver/ (the store at that product)
//   /inquiries/  /sitemap/
//   /privacy-policy/  /terms-of-service/ (linked from the footer)
//   /blog/  /blog/2/  /blog/<entry slug>/, and the same under /off-the-clock/
//   /#license/<Stripe checkout id>, where Stripe sends a license buyer back (private: no page)
// Any other path gets 404.html, which shows Page not found.
// Links to a view switch to it here. A view's old hash route (/#store, still in links out
// there) shows it and gives way to its address; any other hash is a plain in-page anchor
// (footnotes, say).

import { html, render, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { mountContactForms } from './contact.ts';
import { mountStore, mountLicense } from './store.ts';
import { mountProfileZoom } from './profile.ts';
import { mountCourse } from './course.ts';

// The #site-data JSON (site.el): index.org's :view: sections and the collections.
interface Section { id: string; title: string; html: string; description: string; image: string }
interface Entry {
    slug: string; date: string; dateLabel: string; title: string; excerpt: string; html: string;
    video?: string; poster?: string; image?: string;
}
interface Collection { title: string; description: string; image: string; intro: string; perPage: number; entries: Entry[] }
interface SiteData { views: Section[]; collections: Record<string, Collection>; tabs: Record<string, string>; feed: string }
// A view in the menu (TABS) or off it (PAGES).
interface View {
    route: string; label: string;
    sections?: string[]; collection?: string; under?: string; product?: boolean;
}
// What an address names: a view (its tab), and in a collection a page of its listing or an
// entry; Stripe's thank-you page (session); a path that names nothing (path).
interface Route { tab: string; page?: number; entry?: number; session?: string; path?: string; hash?: boolean }

const SITE = 'Adam Schaefers';
const data: SiteData = JSON.parse(document.getElementById('site-data')!.textContent!);
const sections = Object.fromEntries(data.views.map(v => [v.id, v]));
// Collections (blog.org and blog/, off-the-clock.org and off-the-clock/): dated entries,
// newest first, listed a page at a time. An entry with a video is shown as that video.
// One RSS feed (data.feed) carries every collection.
const collections = data.collections;

// Menu tabs, in the menu's order (site-tabs in site.el draws the menu: each tab's address,
// label and icon; the labels come here in #site-data): the route each opens and what it
// shows (index.org sections by CUSTOM_ID, or a collection by name).
const SHOWS: Omit<View, 'label'>[] = [
    { route: 'quest-log', sections: ['about', 'quest-log', 'slop-shelf'] },
    { route: 'blog', collection: 'blog' },
    { route: 'off-the-clock', collection: 'off-the-clock' },
    { route: 'store', sections: ['store'] },
    { route: 'inquiries', sections: ['inquiries'] },
];
const TABS: View[] = SHOWS.map(t => ({ ...t, label: data.tabs[t.route] }));
// Views that aren't in the menu; while one is open, the tab it hangs off is highlighted. A
// product's route shows the store at that product (its <article id="product-<route>">), at
// /store/<route>/; its old /<route>/ still leads there.
const PAGES: View[] = [
    { route: 'backseat-driver', label: 'Backseat Driver commercial license', sections: ['store'], under: 'store', product: true },
    { route: 'privacy-policy', label: 'Privacy policy', sections: ['privacy-policy'] },
    { route: 'terms-of-service', label: 'Terms of service', sections: ['terms-of-service'] },
];
const DEFAULT = 'quest-log';
const RSS_ICON = '<path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14"/><circle cx="6" cy="18" r="1.2"/>';

const findView = (route: string) => TABS.find(t => t.route === route) || PAGES.find(p => p.route === route);
const pageCount = (c: Collection) => Math.max(1, Math.ceil(c.entries.length / c.perPage));

// The view a route names ('store', 'blog/2', 'blog/<entry slug>', '' for the home page), or
// null when it names none (an entry since removed among them).
function parse(route: string): Route | null {
    if (!route || route === 'about' || route === 'slop-shelf') return { tab: DEFAULT };
    if (route === 'sitemap') return { tab: 'sitemap' };
    const [name, rest] = route.split(/\/(.*)/s);
    if (name === 'license' && rest) return { tab: 'license', session: rest };
    const tab = findView(name);
    if (!tab) return null;
    if (tab.sections) {
        if (rest === undefined) return { tab: name };
        const product = PAGES.find(p => p.product && p.under === name && p.route === rest);
        return product ? { tab: product.route } : null;
    }
    const c = collections[tab.collection!];
    if (rest === undefined) return { tab: name, page: 1 };
    if (/^\d+$/.test(rest)) return { tab: name, page: Math.min(Math.max(Number(rest), 1), pageCount(c)) };
    const i = c.entries.findIndex(e => e.slug === rest);
    return i < 0 ? null : { tab: name, entry: i };
}

function decode(s: string) {
    try {
        return decodeURIComponent(s);
    } catch {
        // A malformed % sequence (a half-copied link): take it as typed.
        return s;
    }
}

// A view's address, where site.el writes its page: /, /store/, /store/<product>/, /blog/2/,
// /blog/<slug>/.
function address(route: string, rest?: string | number) {
    if (route === DEFAULT) return '/';
    const view = findView(route);
    const at = view?.product ? `/${view.under}/${route}/` : `/${route}/`;
    return rest ? `${at}${rest}/` : at;
}
const pageHref = (route: string, n: number) => address(route, n > 1 ? n : '');

function addressOf(r: Route): string {
    if (r.tab === 'license') return `/#license/${r.session}`;
    if (r.tab === 'not-found') return r.path!;
    if (r.entry !== undefined) return address(r.tab, collections[findView(r.tab)!.collection!].entries[r.entry].slug);
    return pageHref(r.tab, r.page || 1);
}

// The view a URL names: an old hash route (/#store) or Stripe's /#license/..., else the
// path. Exactly: only a view's own address, so a link to a file (/blog/photo.jpg) stays one.
function routeAt(url: URL | Location, exactly?: boolean): Route | null {
    const hash = decode(url.hash.slice(1));
    const fromHash = hash && parse(hash);
    if (fromHash) return { ...fromHash, hash: true };
    const r = parse(decode(url.pathname).replace(/^\/+|\/+$/g, ''));
    return r && (!exactly || addressOf(r) === url.pathname) ? r : null;
}

const icon = (paths: string) => unsafeHTML(`<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`);

// The styles of the elements drawn here are Tailwind's utilities (site.css). Some repeat:
// an entry's title link, the cards that say there's nothing here, and the pager's and a
// post's newer/older links.
const TITLE_LINK = 'text-sand no-underline hover:text-turq';
const NOTE_CARD = 'mt-6 rounded-2xl bg-mesa px-7 py-6 text-dust inset-ring inset-ring-ridge';
const PAGER_LINK = 'whitespace-nowrap rounded-full bg-mesa px-[1.2rem] py-[.6rem] font-semibold text-sand no-underline inset-ring inset-ring-ridge hover:text-turq hover:inset-ring-turq';
const POST_LINK = 'block rounded-xl bg-mesa px-5 py-4 leading-[1.35] font-semibold text-sand no-underline inset-ring inset-ring-ridge hover:text-turq hover:inset-ring-turq';
const POST_LINK_LABEL = 'mb-1 block text-[.85rem] font-medium text-dust';

// An index.org section, wrapped the way Org exports it so index.org's styles apply.
const section = (s: Section) => html`
    <div id="outline-container-${s.id}" class="outline-2">
        <h2>${s.title}</h2>
        <div class="outline-text-2" id="text-${s.id}">${unsafeHTML(s.html)}</div>
    </div>`;

// src on the element itself, not a <source>, so a reused element loads the new video.
const video = (e: Entry, cls = '') => html`
    <video controls playsinline preload="metadata" src=${e.video} poster=${e.poster || nothing} class="block aspect-[9/16] h-auto w-full rounded-xl bg-mesa ${cls}"></video>`;

// A listing entry: a post's excerpt, or a travelog's video and caption.
const entry = (route: string, e: Entry) => e.video ? html`
    <li class="travelog [&_p]:m-0 [&_p]:text-[.9rem] [&_p]:text-dust">
        ${video(e)}
        <time class="mt-[.6rem] block text-[.85rem] text-dust" datetime=${e.date}>${e.dateLabel}</time>
        <h3 class="mx-0 mt-[.1rem] mb-[.35rem] text-[1.15rem] leading-[1.2] font-[750] font-stretch-85%"><a class=${TITLE_LINK} href=${address(route, e.slug)}>${e.title}</a></h3>
        ${unsafeHTML(e.excerpt)}
    </li>` : html`
    <li class="entry border-t border-t-ridge py-7 [&_p]:m-0 [&_p]:mb-3 [&_p]:text-bone">
        <time class="text-[.9rem] text-dust" datetime=${e.date}>${e.dateLabel}</time>
        <h3 class="mx-0 mt-1 mb-[.6rem] text-[1.45rem] leading-[1.2] font-[750] font-stretch-85% tracking-[-.01em]"><a class=${TITLE_LINK} href=${address(route, e.slug)}>${e.title}</a></h3>
        ${unsafeHTML(e.excerpt)}
        <a class="text-[.95rem] font-semibold" href=${address(route, e.slug)}>Read post →</a>
    </li>`;

function listing(route: string, c: Collection, page: number) {
    const pages = pageCount(c);
    const shown = c.entries.slice((page - 1) * c.perPage, page * c.perPage);
    return html`
    <div class="outline-2 blog">
        <h2>${c.title}</h2>
        ${unsafeHTML(c.intro)}
        <p class="m-0"><a class="inline-flex items-center gap-[.4rem] text-[.9rem] font-semibold text-dust no-underline hover:text-turq [&>svg]:size-4" href=${data.feed}>${icon(RSS_ICON)}RSS feed</a></p>
        ${shown.length
            ? html`<ol class=${shown.some(e => e.video)
                ? 'travelogs m-0 mt-6 grid list-none grid-cols-[repeat(2,minmax(0,17rem))] gap-x-4 gap-y-8 p-0'
                : 'entries m-0 mt-6 list-none p-0'}>${shown.map(e => entry(route, e))}</ol>`
            : html`<div class=${NOTE_CARD}>
                <p class="m-0 text-[1.35rem] font-[750] font-stretch-85% text-sand">Nothing here yet.</p>
                <p class="m-0">Watch this space. The RSS feed will tell you when the first post lands.</p>
              </div>`}
        ${pages > 1 ? html`
        <nav class="pager mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-t border-t-ridge pt-6 [&>:last-child]:justify-self-end" aria-label="Pages">
            ${page > 1 ? html`<a class=${PAGER_LINK} href=${pageHref(route, page - 1)} rel="prev">← Newer</a>` : html`<span></span>`}
            <span class="text-[.9rem] text-dust tabular-nums">Page ${page} of ${pages}</span>
            ${page < pages ? html`<a class=${PAGER_LINK} href=${pageHref(route, page + 1)} rel="next">Older →</a>` : html`<span></span>`}
        </nav>` : nothing}
    </div>`;
}

function single(route: string, label: string, c: Collection, i: number) {
    const e = c.entries[i], newer = c.entries[i - 1], older = c.entries[i + 1];
    return html`
    <article class="outline-2 post">
        <header class="mb-10">
            <a class="mb-5 inline-block text-[.9rem] font-semibold text-dust no-underline hover:text-turq" href=${pageHref(route, Math.floor(i / c.perPage) + 1)}>← ${label}</a>
            <h2 class="mx-0 mt-0 mb-[.9rem] text-[clamp(2rem,4.6vw,3rem)] leading-[1.02] font-extrabold font-stretch-75% tracking-[-.02em]">${e.title}</h2>
            <time class="block text-dust" datetime=${e.date}>${e.dateLabel}</time>
        </header>
        ${e.video ? video(e, 'mb-6') : nothing}
        ${unsafeHTML(e.html)}
        <nav class="mt-12 grid grid-cols-[1fr_1fr] gap-4 border-t border-t-ridge pt-6 narrow:grid-cols-[1fr]" aria-label="More">
            ${newer ? html`<a class=${POST_LINK} href=${address(route, newer.slug)} rel="prev"><span class=${POST_LINK_LABEL}>← Newer</span>${newer.title}</a>` : nothing}
            ${older ? html`<a class="${POST_LINK} col-start-2 text-right narrow:col-auto" href=${address(route, older.slug)} rel="next"><span class=${POST_LINK_LABEL}>Older →</span>${older.title}</a>` : nothing}
        </nav>
    </article>`;
}

// Every view and entry, for people; sitemap.xml is for crawlers.
const sitemap = () => html`
    <div class="outline-2 sitemap">
        <h2>Sitemap</h2>
        <ul class="m-0 mb-6 pl-5">
            ${TABS.map(t => html`<li class="my-[.35rem]">
                <a href=${address(t.route)}>${t.label}</a>
                ${t.collection && collections[t.collection].entries.length ? html`<ul class="mx-0 mt-[.35rem] mb-3 pl-5">
                    ${collections[t.collection].entries.map(e => html`<li class="my-[.35rem]"><a href=${address(t.route, e.slug)}>${e.title}</a> <time class="text-[.85rem] text-dust" datetime=${e.date}>${e.dateLabel}</time></li>`)}
                </ul>` : nothing}
            </li>`)}
            ${PAGES.map(p => html`<li class="my-[.35rem]"><a href=${address(p.route)}>${p.label}</a></li>`)}
        </ul>
        <h3>Feeds</h3>
        <ul class="m-0 mb-6 pl-5">
            <li class="my-[.35rem]"><a href=${data.feed}>RSS feed</a> (the blog and Off the clock)</li>
            <li class="my-[.35rem]"><a href="sitemap.xml">sitemap.xml</a></li>
        </ul>
    </div>`;

// A path that names no view (404.html). Points at the view its first part names, if any:
// /off-the-clock/<a removed entry>/ offers Off the clock.
function notFound(path: string) {
    const near = findView(decode(path).split('/')[1]);
    return html`
    <div class="outline-2 not-found">
        <h2>Page not found</h2>
        <div class=${NOTE_CARD}>
            <p class="m-0 mb-2 text-[1.35rem] font-[750] font-stretch-85% text-sand">Nothing lives at <code>${decode(path)}</code>.</p>
            <p class="m-0">The link may be mistyped, or the page may have moved. Try ${near
                ? html`<a href=${address(near.route)}>${near.label}</a>, `
                : nothing}the <a href="/">home page</a> or the <a href="/sitemap/">sitemap</a>.</p>
        </div>
    </div>`;
}

// Where Stripe sends a license buyer back; js/store.ts fills in the key.
const license = (session: string) => html`
    <div class="outline-2 license">
        <h2>Thank you!</h2>
        <div id="license-mount" data-session=${session}></div>
    </div>`;

function view(r: Route) {
    if (r.tab === 'sitemap') return sitemap();
    if (r.tab === 'license') return license(r.session!);
    if (r.tab === 'not-found') return notFound(r.path!);
    const t = findView(r.tab)!;
    if (t.collection) {
        const c = collections[t.collection];
        return r.entry === undefined ? listing(t.route, c, r.page!) : single(t.route, t.label, c, r.entry);
    }
    return t.sections!.map(id => section(sections[id]));
}

function title(r: Route) {
    if (r.tab === DEFAULT) return SITE;
    if (r.tab === 'sitemap') return `Sitemap · ${SITE}`;
    if (r.tab === 'license') return `Your license key · ${SITE}`;
    if (r.tab === 'not-found') return `Page not found · ${SITE}`;
    const t = findView(r.tab)!;
    if (r.entry !== undefined) return `${collections[t.collection!].entries[r.entry].title} · ${SITE}`;
    if (r.page! > 1) return `${t.label}, page ${r.page} · ${SITE}`;
    return `${t.label} · ${SITE}`;
}

const nav = document.getElementById('site-nav')!;
const app = document.getElementById('app')!;
let shown: string | null = null; // the address of the view on screen

// The menu is site.el's static HTML (each tab's link carries its route); the open tab is
// marked here.
function menu(active: string) {
    for (const a of nav.querySelectorAll<HTMLAnchorElement>('a[data-route]')) {
        if (a.dataset.route === active) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
    }
}

// A new view starts at the top of the page, or at its product.
function toStart(r: Route, first?: boolean) {
    const product = PAGES.find(p => p.route === r.tab && p.product) && document.getElementById(`product-${r.tab}`);
    if (product) product.scrollIntoView({ behavior: 'instant', block: 'start' });
    else if (!first) scrollTo({ top: 0, behavior: 'instant' });
}

// Show the view the address bar names, and put its address there in place of an old hash
// route. An in-page anchor and a query (?fbclid=...) stay, and so does a path that names
// no view: Page not found shows what was asked for.
function show() {
    const r: Route = routeAt(location) || { tab: 'not-found', path: location.pathname };
    const at = addressOf(r);
    const want = r.hash ? at : at + location.hash;
    if (location.pathname + location.hash !== want) {
        history.replaceState(history.state, '', want.replace(/#|$/, `${location.search}$&`));
    }
    if (at === shown) return;
    menu(PAGES.find(p => p.route === r.tab)?.under || r.tab);
    // The page came with its view drawn (site.el); lit draws beside what's there, so clear
    // it the first time.
    if (shown === null) app.replaceChildren();
    render(view(r), app);
    mountContactForms(app);
    mountStore(app);
    mountLicense(app);
    document.title = title(r);
    toStart(r, !shown);
    shown = at;
}

// Where a link goes, if to a view: its route, else null (a file, another site, an anchor).
function linkRoute(a: HTMLAnchorElement) {
    const href = a.getAttribute('href')!;
    if (href.startsWith('#')) return href.length > 1 ? parse(decode(href.slice(1))) : null;
    const url = new URL(href, document.baseURI);
    return url.origin === location.origin ? routeAt(url, true) : null;
}

// A link to a view switches to it here, without loading a page; one to the view on screen
// goes back to its start. The page has <base href="/"> (site.el), which would send a bare
// #anchor to the home page, so those are followed here on the page they're on.
document.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
        || a.target || a.hasAttribute('download')) return;
    const r = linkRoute(a);
    if (r) {
        e.preventDefault();
        const at = addressOf(r);
        if (location.pathname + location.hash !== at) history.pushState(null, '', at);
        if (at === shown) toStart(r);
        else show();
    } else if (a.getAttribute('href')!.startsWith('#')) {
        e.preventDefault();
        location.hash = a.getAttribute('href')!;
    }
});

// Phones: tapping the highlighted button for the page you're on jumps back to the top.
const phone = matchMedia('(max-width: 56rem)');
nav.addEventListener('click', e => {
    if (phone.matches && (e.target as Element).closest('a[aria-current]')) {
        e.preventDefault();
        scrollTo({ top: 0, behavior: 'instant' });
    }
});

// The sidebar's photo and course player (index.org's Contact section, on every page).
mountProfileZoom();
mountCourse();
document.getElementById('year')!.textContent = String(new Date().getFullYear());
addEventListener('popstate', show);
addEventListener('hashchange', show);
show();
