# adamschaefers.com

Source for [adamschaefers.com](https://adamschaefers.com). The page is
written in `index.org` and exported to `index.html`.

Clone with the [a-schaefers](https://github.com/a-schaefers/a-schaefers)
profile README as a submodule:

```sh
git clone --recursive https://github.com/a-schaefers/adamschaefers.com.git
```

Or, in an existing clone, fetch the submodule if it is missing:

```sh
make submodule
```

Then:

- `make build` regenerates `index.html`, the RSS feed (`rss.xml`) and
  `sitemap.xml` from `index.org`, `blog.org`,
  `blog/*.org`, `off-the-clock.org` and `off-the-clock/*.org` (needs Emacs).
- `make run` serves the site at http://localhost:8000.
- `make worker` deploys the contact form's Cloudflare Worker.
- `make licenses-test` tests the store's license server (`license-worker/`)
  offline; `make licenses` tests and deploys it (live: real money).

Install the git hook that, before each commit, builds the generated files
from what's being committed and adds them to it:

```sh
cp scripts/pre-commit .git/hooks/pre-commit
```
