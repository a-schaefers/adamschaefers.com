# CLAUDE.md

Edit `index.org`, never `index.html`. `README.md` covers repo setup only.

After editing, regenerate the HTML with:

    make build

The Inquiries form at the bottom of the page posts to `contact-worker/`, a
Cloudflare Worker at contact-api.adamschaefers.com. It checks Turnstile and
emails the message to adam.schaefers@icloud.com through Email Routing.
The enchant.games Press page posts to the same Worker; its origin is in
`SITES` in `contact-worker/src/index.js`, which also labels each email with
the site it came from. Both sites share one Turnstile widget, so a new site
needs its hostname added to the widget in the Cloudflare dashboard and to
`TURNSTILE_HOSTNAMES`. Deploy it with `make worker`. Its Turnstile secret
is a Worker secret (`wrangler secret put TURNSTILE_SECRET`), not in the repo.

`a-schaefers/` is a git submodule holding the GitHub profile README
(github.com/a-schaefers/a-schaefers). `make submodule` clones it if missing.
Keep it in sync with this site: when you change the core content of
`index.org` (bio, projects, links), make the matching change in
`a-schaefers/README.md`, commit and push it in the submodule, then commit
the updated submodule pointer here.

`make run` serves the site locally at http://localhost:8000.
