# CLAUDE.md

Edit the Org sources. The HTML, the feed and the sitemap are build output: git
ignores them, and CI builds and deploys them on every merge. `README.md` covers
repo setup only. After editing, build and look with:

    make build      # make run serves it at http://localhost:8000

Every change reaches `master` through a pull request (`scripts/ship.sh`), and
the merge is the deploy: `.claude/rules/cicd.md` is the pipeline.

The site is one page, built by `site.el`. `index.html` is `index.org`
exported without its `:view:` sections; those sections and the collections
(below) go into a JSON blob in the page head (`#site-data`), so the first
load carries everything. The menu is static HTML (`site-tabs` in `site.el`:
each tab's route, address, label and icon); `js/app.ts` (lit-html, from npm)
marks the open tab and renders one view at a time from it. The build also draws
each page's own view into its `<main>` (the home's three sections, a view's
section; the collections' listings and the sitemap only app.ts draws), so it is
on screen before the script runs, which clears and redraws it. Each view
has a real address (`/` for Projects, `/inquiries/`, `/sitemap/`, and for
each collection `/blog/`, `/blog/2/`, `/blog/<entry slug>/`), and the build
writes the page at each: `index.html` again, with that view's title and
preview tags (below), plus `404.html` for any other path (served with a
404; app.ts shows Page not found, pointing at the view the path's first part
names, if any). `js/app.ts` catches
links between views and switches without a page load (History API), so the
address bar always holds the view's own address. The page has
`<base href="/">`, so relative links reach the same files from every address,
and app.ts follows bare `#anchors` on the page they're on. Old hash routes
(`/#store`, still in links out there) show the view and give way to its
address. Link views by address (`<a href="/inquiries/">`), not `#inquiries`.
A section is shown by tagging it `:view:` and listing it under a tab
in `TABS` in `js/app.ts` (Projects shows About, the Quest Log and the slop
shelf); the tab itself is in `site-tabs` in `site.el`.
All the code is TypeScript, and npm manages everything from outside
(`package.json`, pinned; nothing vendored). `make build` compiles first
(`scripts/build.ts`): esbuild bundles `js/app.ts` and all it imports (lit-html,
`js/contact.ts`, `js/store.ts`, and the sidebar's `js/profile.ts` and
`js/course.ts`) into one `js/app.<hash>.js`, and Tailwind compiles `site.css`
into `site.<hash>.css`; a browser keeps both for good, a change being a new name.
`make typecheck` checks every TypeScript project (each has its own
`tsconfig.json`: the browser's code, each Worker, their tests, the Node scripts).
Node runs the tests and scripts as they are (`node scripts/check-dist.ts`), and
wrangler compiles the Workers.
The sidebar (index.org's Contact section) and the footer (`site.el`, with
the Sitemap, Privacy and Terms links) are written once and frame every view.
The sidebar's avatar is `images/me-thumb.webp`, a 480px crop of `me.jpeg`,
which only the zoom loads (lazy; fetched when the avatar is pointed at); the
course's thumbnails are `images/course/<video id>.jpg`, served from here so a
page view reaches no YouTube server.
The privacy policy and terms of service (`/privacy-policy/`,
`/terms-of-service/`) are `:view:` sections in index.org, routed through
`PAGES` in `js/app.ts`; keep the policy in step with what the site and
`license-worker/` actually collect and who they send it to.
Link previews (social media, chat apps) and crawlers read HTML without running
JavaScript and drop everything after `#`; that's why views have real
addresses. Every view, product, entry and later listing page has its page
(`store/index.html`, `store/backseat-driver/index.html`,
`off-the-clock/<slug>/index.html`; listed in `share-pages.txt`, which the
build uses to drop pages that are gone), and each carries its
title, a description and a picture. Set them in
the Org sources: `:DESCRIPTION:` and `:IMAGE:` properties on a view's heading,
`#+DESCRIPTION` and `#+IMAGE` in `blog.org`, `off-the-clock.org` and each
entry, `data-share-image` on a product's `<article>` (previews want PNG or
JPEG, not WebP). Without them: the first paragraph or excerpt, a travelog's
poster, and `images/og.jpg` (the 1200x630 card of the profile photo, name and
roles). `index.html` carries the home page's preview tags.
The styles are Tailwind (v4), configured in `site.css`: the palette, fonts and
animations are its theme, and its breakpoints are `phone:` (the bottom tab bar
and one column, up to 56rem), `narrow:` (40rem) and `tall:`. Markup the
TypeScript renders (`js/`) and `site.el` writes (the menu's and footer's
frames) carries utility classes. Markup Org writes and index.org's own HTML
blocks (the sidebar, the products) keep semantic classes, styled in `site.css`
with `@apply`; Tailwind reads only `js/` and `site.el` for classes, so a
utility class in index.org does nothing. No preflight: the browser's defaults
are the reset, with `site.css`'s base layer on top. Org's section wrappers are
`.outline-2`, which `site.css` keeps from becoming Tailwind's 2px outline.

A collection is a folder of dated entries plus an index file, listed newest
first and paginated: the Blog (`blog/`, `blog.org`) and Off the clock
(`off-the-clock/`, `off-the-clock.org`). Both are declared in
`site-collections` in `site.el` and as tabs with `collection:` in `TABS`.
Entries are `DIR/YYYY-MM-DD-slug.org`: date from the file name, title from
`#+TITLE`, listing excerpt from `#+DESCRIPTION` or the first paragraph. An
entry with `#+VIDEO` (and `#+POSTER`) shows as that video, its text the
caption; that's every Off the clock entry (travelogs). The video is an
address on the media domain (`#+VIDEO: https://media.adamschaefers.com/evia.mp4`,
below). Entry HTML is shown from the site root, so link files in the repo as
`blog/...`, `videos/...` (the posters).
Links out of the site open in a new tab. The index file holds the
collection's title, intro and `#+POSTS_PER_PAGE` (Off the clock: 12).

The build also writes `rss.xml`, one feed for both collections (a reader
subscribes once): every entry in full, newest first, tagged with its
collection as `<category>`, site-relative links made absolute against
https://adamschaefers.com/ and videos as enclosures. Items link to the
entries' addresses; their guids keep the old `#route` form, so readers don't
show every entry again. It also writes `sitemap.xml`, every page for
crawlers; the `/sitemap/` view lists them for people.
`robots.txt` points at `sitemap.xml`. Nothing the build writes is committed:
git ignores every page's `index.html`, `404.html`, `rss.xml`, `sitemap.xml`,
`share-pages.txt`, `assets.txt`, `build/` (the compiled script and styles),
the Workers' `src/admin-page.gen.ts` (below) and `public/`. `make build` ends
with `scripts/dist.sh`, which assembles `public/`: exactly what the site serves
(the pages, the hashed styles, script (with its source map) and fonts, and the
tracked files pages link to; not the TypeScript, `node_modules`, the Org
sources or the Workers), plus `_headers` and `_redirects` from
`site-worker/`.

Hosting (2026-10-11; before it, GitHub Pages served the repository as it was):
`site-worker/` is the Worker `adamschaefers-site`, on the route
`adamschaefers.com/*` (the apex's DNS record is a proxied placeholder). It
serves `public/` as Workers Static Assets: `/store` redirects to `/store/`,
any path without a page gets `404.html` with a 404, pages carry
`max-age=0, must-revalidate` and an ETag (a 304 when nothing changed), and
the hashed styles and scripts are kept for good (the `_headers` dist writes).
Static asset requests never run the Worker's script, cost nothing and don't
count toward the account's 100,000 Worker requests a day (the free plan,
shared with merecatholicity.com); only `/admin` runs it. Never add `"cache"`
(Workers caching) to its `wrangler.jsonc`: it would bill every asset request
as the Worker's (a test keeps it out). A deploy uploads only the changed files
and switches them all at once; `npx wrangler rollback -c
site-worker/wrangler.jsonc` goes back a version, files and all.

Videos, pictures and files too big or too changeable for git live in R2, the
bucket `adamschaefers-media`, which R2 itself serves at
https://media.adamschaefers.com/ (the bucket's custom domain: Cloudflare's
edge cache, range requests so videos seek, no Worker involved). Manage them at
https://adamschaefers.com/admin/ (`site-worker/src/admin.ts`, behind the
Cloudflare Access application "adamschaefers.com assets admin",
adam.schaefers@icloud.com): upload one (up to 100 MB), copy its Org line
(`#+VIDEO: https://media.adamschaefers.com/evia.mp4`, `[[https://media.adamschaefers.com/photo.jpg]]`)
or its address, delete one. An upload is kept in caches an hour, so a changed
file gets a new name (the admin refuses a taken name unless Replace is
ticked). `make check` asks for every media address a page names, and the feed
gives each video's size from its answer. The old `/videos/<name>.mp4`
addresses redirect there (`site-worker/_redirects`). Encode videos before
uploading, with ffmpeg as H.264 High + AAC, yuv420p, `-movflags +faststart`
(index first, so playback starts while downloading) and `-map_metadata -1`;
several clips meant to play as one get joined into one file. Give each a JPEG
poster. iPhone uploads are often HEVC `.mov`, which many desktop browsers
can't play, so always re-encode.

The fonts are npm packages, listed in `site-fonts` in `site.el`: Bricolage
Grotesque (Fontsource's variable font, latin and latin-ext subsets; the latin
one is preloaded) and the flag font, which draws flag emoji Windows lacks.
The build publishes each under a hashed name in `fonts/` and points `site.css`
at it, so browsers keep them for good. Nothing loads from Google Fonts. See
`fonts/README.md`.

Each Worker's admin page (the assets at `/admin/` here, the licenses below)
has its script in `src/admin-page.ts` and its styles in `src/admin-page.css`
(Tailwind, the site's palette): `scripts/build.ts` compiles them into
`src/admin-page.gen.ts`, which the Worker inlines in the page. `make workers`
makes just those (`make build` makes them too); the Workers' tests, tsc and
wrangler need them, so the deploy makes them before it runs wrangler.

The Store (`/store/`, index.org's Store section) sells licenses: real Stripe,
real money (there is no sandbox). Each product is an
`<article class="product" id="product-<id>">` with its image
(`images/store/<id>.webp`, which zooms on a click; `data-share-image` names a
PNG or JPEG copy for link previews), its words in Org, and two mounts that
`js/store.ts` fills from their `data-*` attributes (product id, prices, volume
seats; they must match the Worker's): the buy form, and "Add seats to your
license", a link (so several products don't repeat a box down the page) that
opens a card which shows a key's seats and recent installs and adds seats. Below the products, "Lost your key?" emails an address every key
on file for it (each license's newest unrevoked key; the answer never says
whether there were any, and goes out before the lookup, so its timing can't
either; per address one email per 30 seconds and 5 a day, and
40 a day in all, keeping most of Resend's free 100 a day for key emails).
Recovery, which sends email, passes a Turnstile check (the "adamschaefers
store" widget, adamschaefers.com only), rendered only once "Lost your key?"
is opened. Buying and adding seats don't (owner, 2026-10-11): they only make
a Stripe Checkout page, which has Stripe's own CAPTCHA and card-testing
defenses, and adding seats needs a signed key. The server takes requests
from the site's origin only, so locally the store shows but can't buy.
`js/store.ts` renders the check with `loadTurnstile` from
`js/contact.ts` (Turnstile's script must be on the page once), and shares its
"sent" card. A Cloudflare rate-limit rule on
the zone allows 5 `POST /v1/checkout` or `/v1/recover` per IP per 10 seconds,
and the Worker's own limit 20 a minute per IP on every site route.
Bot Fight Mode stays off: on the free plan it can't be skipped, and it would
challenge Stripe's webhooks, the plugin's key check and the contact form. A
product's own address (`/store/backseat-driver/`, `PAGES` in `js/app.ts`;
the old `/backseat-driver/` still leads there) shows the store at that
product. Stripe returns buyers to `/#license/<checkout id>` (the
one view left on a hash: private, so no page), where
the key is shown (copy, print) and said to be emailed, for a week after the
purchase: the address lives on in browser history, so after that the page
points to the email and "Lost your key?"; printing it prints just the key.
The store's admin link goes to the license server's `/admin`.

`license-worker/` is that server: a Cloudflare Worker at
licenses.adamschaefers.com with its D1 database (`adamschaefers-licenses`).
It sells several products under one buy-once, lifetime model: they are
`src/products.ts`, and each product's two Stripe prices (per seat, and per
seat once a license has `volumeSeats`) are `PRICES` in `wrangler.jsonc`. It
makes Stripe Checkouts, issues a key when Stripe says paid (webhook, or the
thank-you page asking first), signs it (`<prefix>.<payload>.<signature>`,
Backseat Driver's format, which its app checks offline against the public key
it ships; `BSD1.` for Backseat Driver),
emails it through Resend from licenses@adamschaefers.com (send only: the email
says not to reply and links the contact form; no colors, so dark mode reads
it), emails the owner (adam.schaefers@icloud.com) of each sale, and revokes the
key on a full refund or a lost chargeback. A paid Checkout that can't become a
key emails the owner too. Licenses are lifetime, one key per purchase covering
its seats; adding seats issues one new key for the new total in the same
family, and the old keys keep working. A family is the license: it stands
while any of its keys does, so refunding only an add-on never withdraws it.
Every product signs with its own key (its `signing` in `src/products.ts`:
a secret `SIGNING_KEY_<PRODUCT>` and kid), never another's: the signature
doesn't cover the prefix, so a product signed with `live-1` (Backseat
Driver's, `SIGNING_KEY`) could have its keys relabelled `BSD1.` and pass in
shipped copies. Apps check a key at `GET /v1/products/<product>/keys/<id>`
(rate limited) with an anonymous install id; the unscoped `/v1/keys/<id>` and
`/v1/public-keys` stay Backseat Driver's only, as its shipped copies and its
release script (which checks every key listed there) expect; the server
keeps at most max(50, 3 × seats) installs per license and counts those seen in 14 days. Seats are on the honor system and nothing is
ever locked. Installs can't tell people from machines, so nothing is said
until installs are more than twice the seats and 5 over for two weeks running;
then the check answers `outgrown: true`, the app shows everyone using the
license a small note asking for more seats (owner, 2026-10-11), and the buyer
gets one polite email, at most every 90 days. `/admin` (behind Cloudflare Access,
adam.schaefers@icloud.com) lists every license of every product (each one's
totals, a filter) and email, and withdraws,
restores (whole licenses), resends and issues by hand. Its per-request logs are
off (no IP addresses kept). Secrets are Worker secrets only (`wrangler secret
put`, listed in `wrangler.jsonc`); a local copy lives in the git-ignored
`license-worker/.dev.vars` and the signing keys (one per product) in
`~/.config/adamschaefers-licenses/`, never in the repo. All of them are backed
up in the private repository a-schaefers/adamschaefers.com-private (cloned
beside this one, not a submodule: this repo is public), whose README says how
to restore them; update it when a secret changes. A database change is a new
file in `license-worker/migrations/`, run once on the database by hand
(`npx wrangler d1 execute adamschaefers-licenses --remote --file ...`) before
the merge that needs it, since CI doesn't apply migrations, and `schema.sql`
kept as the whole. `make licenses-test` runs its tests offline (Node's SQLite
stands in for D1; Stripe, Resend and Access are faked); there is no sandbox,
so a change is tested there, and CI deploys it when the pull request merges.

Caching (audited 2026-10-10): no cache may ever keep anything personal. The
site's files are the same for everyone; everything personal (a key's seats,
the thank-you page's key, recovery, `/admin`) is fetched by the browser from
the license server, every answer of which says `Cache-Control: no-store`
(`uncached` in `src/index.ts` adds it to any that lack it, and a test holds
every route to it). Cloudflare never caches a Worker's own answers unless
Workers Cache (`"cache"` in its `wrangler.jsonc`) is switched on, which a test
keeps off for the license server (on, it would keep any answer without
no-store). The contact form takes POSTs only, which no cache keeps. The
thank-you page stays at `/#license/<checkout id>`: what follows `#` never
leaves the browser, so no server, cache or log sees it. Never point a Cache
Rule, `cf.cacheEverything` or the Cache API at the license or contact hosts.
The site (Workers Static Assets, above): its pages are revalidated on every
visit, only hashed files are kept long, and a picture or video that changes
gets a new name rather than replacing a file caches may hold.

The Inquiries (Contact) view's form is mounted by `js/contact.ts`, the module
that began as `js/contact.js` in ../enchant.games (here TypeScript, its
markup Tailwind's). It posts to `contact-worker/`, a
Cloudflare Worker (`adamschaefers-contact`) at contact-api.adamschaefers.com.
It checks Turnstile and emails the message to adam.schaefers@icloud.com
through Email Routing, with Reply-To set to the sender. The sender's email
is required, so every form that posts here needs an `email` field.

The enchant.games Press page (`js/contact.js` in ../enchant.games) posts to
the same Worker; its origin is in `SITES` in `contact-worker/src/index.ts`,
which also labels each email with the site it came from. Both sites share
one Turnstile widget ("adamschaefers contact form"), so a new site needs its
hostname added to the widget in the Cloudflare dashboard and to
`TURNSTILE_HOSTNAMES` in `wrangler.jsonc`.

CI deploys it when a merge changes `contact-worker/`. Its Turnstile secret is
a Worker secret (`wrangler secret put TURNSTILE_SECRET`), not in the repo.

`a-schaefers/` is a git submodule holding the GitHub profile README
(github.com/a-schaefers/a-schaefers), tracking its `main` branch.
`make submodule` clones it if missing. This site and the profile README are
kept in sync: whenever the core content of `index.org` changes (bio,
projects, links), make the matching change in `a-schaefers/README.md` in
the same pass. Commit and push the submodule first (on `main`, not a
detached HEAD), then ship `index.org` and the updated submodule pointer here
together, in one pull request.

Checks and where they run (owner, 2026-10-11: no slow suites on this old
machine when CI already runs them). `make check` is CI's required check
(`.claude/rules/cicd.md`): the build, every link, the types, the Workers'
tests and the workflows' rules, in seconds, so running it before shipping is
cheap. A headless-browser look is worth it after changing `js/` or the styles
(`site.css`, or a template's classes), not after editing words. In
../backseat-driver, don't run its whole suite locally (`npm run check`,
`npm test`): its pull requests' required `check` runs it on GitHub. Run there
only the tests of what you changed and its quick checks; the exceptions (CI
down, a CI failure the logs can't explain, a change to its test kit, or the
owner asks) are in its CLAUDE.md.

`make run` builds and serves `public/` the way the site does (wrangler's
local Workers Static Assets, so `404.html` and the headers too) at
http://localhost:8000 (`PORT=` to change it; `npm ci` once first). Videos come
from the media domain, so they play locally too.

Secrets: those the Workers use are Worker secrets (Cloudflare), each backed up
in a-schaefers/adamschaefers.com-private, whose README says how to restore or
rotate it. The pipeline's one credential, a Cloudflare token scoped to
deploying these three Workers, is the GitHub secret `CLOUDFLARE_API_TOKEN` in
the `production` environment and nowhere else: a lost one is replaced, not
restored (`.claude/rules/cicd.md` has its policy). Never one in this
repository.

`master` takes no direct push (2026-10-11): commit on a branch (or in a
worktree) and run `scripts/ship.sh`, which opens the pull request and arms
auto-merge; it merges once `check` is green, and the merge deploys.
