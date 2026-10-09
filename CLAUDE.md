# CLAUDE.md

Edit `index.org`, never `index.html`. `README.org` is a symlink to `index.org`.

After editing, regenerate the HTML with:

    make build

The Inquiries form at the bottom of the page posts to `contact-worker/`, a
Cloudflare Worker at contact-api.adamschaefers.com. It checks Turnstile and
emails the message to adam.schaefers@icloud.com through Email Routing.
Deploy it with `make worker`. Its Turnstile secret is a Worker secret
(`wrangler secret put TURNSTILE_SECRET`), not in the repo.
