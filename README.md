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

- `make build` regenerates `index.html` from `index.org` (needs Emacs).
- `make run` serves the site at http://localhost:8000.
- `make worker` deploys the contact form's Cloudflare Worker.
