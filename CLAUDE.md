# CLAUDE.md

Edit `index.org`, never `index.html`. `README.org` is a symlink to `index.org`.

After editing, regenerate the HTML with:

    make build

The Inquiries form at the bottom of the page posts to `contact-worker/`, a
Cloudflare Worker at contact-api.adamschaefers.com. It checks Turnstile and
emails the message to adam.schaefers@icloud.com through Email Routing.
Deploy it with `make worker`. Its Turnstile secret is a Worker secret
(`wrangler secret put TURNSTILE_SECRET`), not in the repo.

`a-schaefers/` is a git submodule holding the GitHub profile README
(github.com/a-schaefers/a-schaefers). `make submodule` clones it if missing.
Keep it in sync with this site: when you change the core content of
`index.org` (bio, projects, links), make the matching change in
`a-schaefers/README.md`, commit and push it in the submodule, then commit
the updated submodule pointer here.

`make run` serves the site locally at http://localhost:8000.
