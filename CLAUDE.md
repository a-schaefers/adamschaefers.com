# CLAUDE.md

Edit the org sources, never `index.html` or the generated feeds and sitemap. `README.md` covers repo setup only.

After editing, regenerate the HTML with:

    make build

The site is one page, built by `site.el`. `index.html` is `index.org`
exported without its `:view:` sections; those sections and the collections
(below) go into a JSON blob in the page head (`#site-data`), so the first
load carries everything. `js/app.js` (lit-html, vendored in `js/lit/` from
../enchant.games) renders the menu and one view at a time from it,
switching on hash routes (`#quest-log`, `#inquiries`, `#sitemap`, and for
each collection `#blog`, `#blog/2`, `#blog/<entry slug>`) without page
loads. A section is shown by tagging it `:view:` and listing it under a tab
in `TABS` in `js/app.js` (Projects shows About, the Quest Log and the slop
shelf), which also holds the menu's labels and icons.
If `js/app.js` gains or loses an import, direct or not, update
`site-module-imports` in `site.el`: it preloads them all at content-hashed
URLs and writes an import map sending every import there, so a browser never
pairs a new module with an old cached one. A module missing from the list
still loads, unversioned.
The sidebar (index.org's Contact section) and the footer (`site.el`, with
the Sitemap, Privacy and Terms links) are written once and frame every view.
The privacy policy and terms of service (`#privacy-policy`,
`#terms-of-service`) are `:view:` sections in index.org, routed through
`PAGES` in `js/app.js`; keep the policy in step with what the site and
`license-worker/` actually collect and who they send it to.
`nav.css` styles the menu (top on desktop, bottom tab bar on phones),
`blog.css` the collection views and the sitemap.

A collection is a folder of dated entries plus an index file, listed newest
first and paginated: the Blog (`blog/`, `blog.org`) and Off the clock
(`off-the-clock/`, `off-the-clock.org`). Both are declared in
`site-collections` in `site.el` and as tabs with `collection:` in `TABS`.
Entries are `DIR/YYYY-MM-DD-slug.org`: date from the file name, title from
`#+TITLE`, listing excerpt from `#+DESCRIPTION` or the first paragraph. An
entry with `#+VIDEO` (and `#+POSTER`) shows as that video, its text the
caption; that's every Off the clock entry (travelogs). Entry HTML is shown
from the site root, so link images and files as `blog/...`, `videos/...`.
Links out of the site open in a new tab. The index file holds the
collection's title, intro and `#+POSTS_PER_PAGE` (Off the clock: 12).

The build also writes `rss.xml`, one feed for both collections (a reader
subscribes once): every entry in full, newest first, tagged with its
collection as `<category>`, site-relative links made absolute against
https://adamschaefers.com/ and videos as enclosures. It also writes
`sitemap.xml`. Crawlers drop everything after `#`, so `sitemap.xml` lists
only the page; the `#sitemap` view lists every view and entry for people.
`robots.txt` points at `sitemap.xml`. `scripts/pre-commit` (installed as
`.git/hooks/pre-commit`) rebuilds and stages all generated files on every
commit, building from the staged files (a copy of the index), so another
session's unstaged edits never ship in them; if you change what the build
generates, update the hook and reinstall it.

The travelog videos are MP4s in `videos/`, committed to git and served by
GitHub Pages, which answers range requests, so they stream and seek with no
server code. Encode new ones with ffmpeg as H.264 High + AAC, yuv420p,
`-movflags +faststart` (index first, so playback starts while downloading)
and `-map_metadata -1`; several clips meant to play as one get joined into
one file. Keep each well under GitHub's 50 MB warning, and give each a JPEG
poster. iPhone uploads are often HEVC `.mov`, which many desktop browsers
can't play, so always re-encode.

`fonts/TwemojiCountryFlags.woff2` draws flag emoji, which Windows lacks; see
`fonts/README.md`.

The Store (`#store`, index.org's Store section) sells licenses: real Stripe,
real money (there is no sandbox). Each product is an
`<article class="product" id="product-<id>">` with its image (a placeholder,
`images/store/placeholder.svg`, until a real one), its words in Org, and two
mounts that `js/store.js` fills from their `data-*` attributes (product id,
prices, volume seats; they must match the Worker's): the buy form and the
"already have a key" box, which shows a key's seats and recent installs and
adds seats. Below the products, "Lost your key?" emails an address every key
on file for it (each license's newest unrevoked key; the answer never says
whether there were any; per address one email per 30 seconds and 5 a day, and
40 a day in all, keeping most of Resend's free 100 a day for key emails).
Buying, adding seats and recovery each pass a Turnstile check (the
"adamschaefers store" widget, adamschaefers.com only, so locally the store
shows but can't buy). `js/store.js` renders it with `loadTurnstile` from
`js/contact.js` (Turnstile's script must be on the page once; that export is
the one difference from enchant.games' copy). A Cloudflare rate-limit rule on
the zone allows 5 `POST /v1/checkout` or `/v1/recover` per IP per 10 seconds.
Bot Fight Mode stays off: on the free plan it can't be skipped, and it would
challenge Stripe's webhooks, the plugin's key check and the contact form. A
product's own route (`#backseat-driver`, `PAGES` in `js/app.js`) shows the
store at that product. Stripe returns buyers to `#license/<checkout id>`, where
the key is shown (copy, print) and said to be emailed. `store.css` styles it.
The store's admin link goes to the license server's `/admin`.

`license-worker/` is that server: a Cloudflare Worker at
licenses.adamschaefers.com with its D1 database (`adamschaefers-licenses`).
What it sells is `src/products.js`; each product's two Stripe prices (per
seat, and per seat once a license has `volumeSeats`) are `PRICES` in
`wrangler.jsonc`. It makes Stripe Checkouts, issues a key when Stripe says
paid (webhook, or the thank-you page asking first), signs it (`BSD1.` keys,
the format Backseat Driver checks offline against the public key it ships),
emails it through Resend from licenses@adamschaefers.com (send only: the email
says not to reply and links the contact form; no colors, so dark mode reads
it), emails the owner (adam.schaefers@icloud.com) of each sale, and revokes the
key on a full refund or a lost chargeback. A paid Checkout that can't become a
key emails the owner too. Licenses are lifetime, one key per purchase covering
its seats; adding seats issues one new key for the new total in the same
family, and the old keys keep working. A family is the license: it stands
while any of its keys does, so refunding only an add-on never withdraws it.
Apps check a key at `GET /v1/keys/<id>` (rate limited) with an anonymous
install id; the server keeps at most max(50, 3 × seats) installs per license
and counts those seen in 14 days. Never a false alarm for a customer who paid:
nobody using the app is shown anything about seats, and the buyer gets one
polite email only when installs are more than twice the seats and 5 over for
two weeks running, at most every 90 days. `/admin` (behind Cloudflare Access,
adam.schaefers@icloud.com) lists every license and email, and withdraws,
restores (whole licenses), resends and issues by hand. Its per-request logs are
off (no IP addresses kept). Secrets are Worker secrets only (`wrangler secret
put`, listed in `wrangler.jsonc`); a local copy lives in the git-ignored
`license-worker/.dev.vars` and the signing key in
`~/.config/adamschaefers-licenses/`, never in the repo. All of them are backed
up in the private repository a-schaefers/adamschaefers.com-private (cloned
beside this one, not a submodule: this repo is public), whose README says how
to restore them; update it when a secret changes. A database change is a new
file in `license-worker/migrations/`, run once on the database, and
`schema.sql` kept as the whole. `make licenses-test` runs its tests offline
(Node's SQLite stands in for D1; Stripe, Resend and Access are faked); there
is no sandbox, so a change is tested there before `make licenses` deploys it.

The Inquiries (Contact) view's form is mounted by `js/contact.js`, the same
module as `js/contact.js` in ../enchant.games. It posts to `contact-worker/`, a
Cloudflare Worker (`adamschaefers-contact`) at contact-api.adamschaefers.com.
It checks Turnstile and emails the message to adam.schaefers@icloud.com
through Email Routing, with Reply-To set to the sender. The sender's email
is required, so every form that posts here needs an `email` field.

The enchant.games Press page (`js/contact.js` in ../enchant.games) posts to
the same Worker; its origin is in `SITES` in `contact-worker/src/index.js`,
which also labels each email with the site it came from. Both sites share
one Turnstile widget ("adamschaefers contact form"), so a new site needs its
hostname added to the widget in the Cloudflare dashboard and to
`TURNSTILE_HOSTNAMES` in `wrangler.jsonc`.

Deploy it with `make worker`. Wrangler needs `wrangler login` or a
`CLOUDFLARE_API_TOKEN`; in a non-interactive session with neither, upload
through the Cloudflare API instead and keep the existing secret
(`keep_bindings: ["secret_text"]`). Its Turnstile secret is a Worker secret
(`wrangler secret put TURNSTILE_SECRET`), not in the repo.

`a-schaefers/` is a git submodule holding the GitHub profile README
(github.com/a-schaefers/a-schaefers), tracking its `main` branch.
`make submodule` clones it if missing. This site and the profile README are
kept in sync: whenever the core content of `index.org` changes (bio,
projects, links), make the matching change in `a-schaefers/README.md` in
the same pass. Commit and push the submodule first (on `main`, not a
detached HEAD), then commit `index.org`, `index.html` and the updated
submodule pointer here together.

Checks and where they run (owner, 2026-10-11: no slow suites on this old
machine when CI already runs them). This repo has no CI: GitHub Pages
publishes whatever is pushed, so its quick local checks are the only ones.
`make build` runs in the pre-commit hook; `make licenses-test` (seconds,
offline) runs before every `make licenses` deploy. A headless-browser look is
worth it after changing `js/` or the CSS, not after editing words. In
../backseat-driver, don't run its whole suite locally (`npm run check`,
`npm test`): its pull requests' required `check` runs it on GitHub. Run there
only the tests of what you changed and its quick checks; the exceptions (CI
down, a CI failure the logs can't explain, a change to its test kit, or the
owner asks) are in its CLAUDE.md.

`make run` serves the site locally at http://localhost:8000 (`PORT=` to
change it).

There is no branch protection; commit and push to `master` directly.
