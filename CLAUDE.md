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
If `js/app.js` gains or loses an import, update `site-module-imports` in
`site.el`, which preloads them all with it.
The sidebar (index.org's Contact section) and the footer (`site.el`, with
the Sitemap link) are written once and frame every view.
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
The four current travelogs carry made-up dates (2026-10-07 to 10) that only
fix their order.

The build also writes each collection's RSS feed (`rss.xml` for the blog,
`off-the-clock.xml`), every entry in full with site-relative links made
absolute against https://adamschaefers.com/ and videos as enclosures, and
`sitemap.xml`. Crawlers drop everything after `#`, so `sitemap.xml` lists
only the page; the `#sitemap` view lists every view and entry for people.
`robots.txt` points at `sitemap.xml`. `scripts/pre-commit` (installed as
`.git/hooks/pre-commit`) rebuilds and stages all generated files on every
commit; if you change what the build generates, update the hook and
reinstall it.

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

`make run` serves the site locally at http://localhost:8000 (`PORT=` to
change it).

There is no branch protection; commit and push to `master` directly.
