# CLAUDE.md

Edit `index.org`, never `index.html`. `README.md` covers repo setup only.

After editing, regenerate the HTML with:

    make build

The site is one page, built by `site.el`. `index.html` is `index.org`
exported without its `:view:` sections; those sections, `blog.org` and the
blog posts go into a JSON blob in the page head (`#site-data`), so the
first load carries everything. `js/app.js` (lit-html, vendored in `js/lit/`
from ../enchant.games) renders the menu and one view at a time from it,
switching on hash routes (`#quest-log`, `#off-the-clock`, `#inquiries`,
`#blog`, `#blog/2`, `#blog/<post slug>`) without page loads.
A section is shown by tagging it `:view:` and listing it under a tab in
`TABS` in `js/app.js` (Projects shows About, the Quest Log and the slop
shelf), which also holds the menu's labels and icons.
The sidebar (index.org's Contact section) and the footer (`site.el`) are
written once and frame every view.
`nav.css` styles the menu (top on desktop, bottom tab bar on phones),
`blog.css` the blog views.

Blog posts are `blog/YYYY-MM-DD-slug.org`: date from the file name, title
from `#+TITLE`, listing excerpt from `#+DESCRIPTION` or the first
paragraph. Their HTML is shown from the site root, so link images and
files as `blog/...`. `blog.org` holds the blog's title, intro and
`#+POSTS_PER_PAGE`.

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
