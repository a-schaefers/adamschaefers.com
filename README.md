# adamschaefers.com

[![check](https://github.com/a-schaefers/adamschaefers.com/actions/workflows/check.yml/badge.svg)](https://github.com/a-schaefers/adamschaefers.com/actions/workflows/check.yml)
[![deploy](https://github.com/a-schaefers/adamschaefers.com/actions/workflows/deploy.yml/badge.svg?branch=master)](https://github.com/a-schaefers/adamschaefers.com/actions/workflows/deploy.yml)

Source for [adamschaefers.com](https://adamschaefers.com). The page is
written in Org (`content/`: `index.org` and the collections) and built with
Emacs; GitHub Actions builds it on every merge to `master` and deploys it to
Cloudflare.

- `content/`: the Org sources, `index.org`, `blog.org` and `blog/`,
  `off-the-clock.org` and `off-the-clock/` (each travelog's poster beside it).
- `static/`: served as it is at the site root (images, `robots.txt`).
- `src/`: the TypeScript and `site.css` (Tailwind).
- `site.el`, `scripts/`, `Makefile`: the build; `site-worker/`,
  `license-worker/`, `contact-worker/`: the Cloudflare Workers.
- `build/` and `public/`: what `make build` writes, never committed.

Clone it:

```sh
git clone https://github.com/a-schaefers/adamschaefers.com.git
```

Then install the toolchain (TypeScript, esbuild, Tailwind, wrangler and the
site's npm packages, pinned in `package.json`; needs Node 24 and Emacs 30):

```sh
npm ci
```

- `make build` builds the site into `public/`: its TypeScript and Tailwind
  styles compiled, then the pages, the RSS feed and the sitemap from
  `content/`, all into `build/`, then `public/` assembled from that and
  `static/`. None of it is committed.
- `make run` serves it at http://localhost:8000, the way the site does,
  rebuilding on every save and reloading the open page.
- `make check` runs what CI's required check runs: the build, every link, the
  types (`make typecheck`), the Workers' tests (offline) and the workflows'
  rules.

Changes reach `master` only through pull requests: commit on a branch and run
`scripts/ship.sh`. The merge deploys the site and, when they changed, the
license server and the contact form (`.claude/rules/cicd.md`).
