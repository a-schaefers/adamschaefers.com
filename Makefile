.PHONY: build workers run pdf check check-dist typecheck test licenses-test

PORT ?= 8000

# The site: its script and styles compiled (scripts/build.ts: esbuild and Tailwind, into
# build/), the Org export (site.el: content/ into pages in build/), then public/, exactly
# what the site serves (scripts/dist.sh, from build/ and static/). None of it is committed:
# CI builds and deploys it on every merge. Here it has the drafts too (content/*/drafts/);
# CI's build never does, nor DRAFTS=0 make build, exactly what the site serves.
build:
	node scripts/build.ts
	emacs -Q --batch -l site.el -f site-build
	sh scripts/dist.sh

# The Workers' admin pages, compiled into the modules they import (src/admin-page.gen.ts, which
# git ignores): the Workers' tests, tsc and wrangler need them. make build makes them too.
workers:
	node scripts/build.ts workers

# public/ served the way the site serves it (Workers Static Assets, locally), at
# http://localhost:8000, rebuilt as the sources change, and open pages reloaded once the
# change is served (scripts/dev.ts: a WebSocket only its local answers carry, never the site).
# Always with the drafts.
run:
	PORT=$(PORT) node scripts/dev.ts

# The book (2026-11-06-machines-of-borrowed-grace.org, in content/blog/ or its drafts/) as a
# PDF, each note at the foot of the page that refers to it: Org to LaTeX (scripts/pdf.el) to
# PDF (pdflatex, in the frame scripts/pdf.tex), into build/pdf/: machines-of-borrowed-grace.pdf
# and the 6x9 interior for Kindle Direct Publishing, machines-of-borrowed-grace-paperback.pdf.
# Once the book is live, the first is also put beside it (content/blog/), where the book
# links to it, committed like a post's picture. Run by hand, or by the commit hook when the
# live book changes (scripts/hooks/pre-commit): never by make build, make run or CI, none
# of which needs TeX.
pdf:
	sh scripts/pdf.sh

# What CI's required check runs: the build, every link, the types, the Workers' tests
# (offline), the workflows' rules. (CI runs the two halves apart, uploading the site between
# them.) The site as CI builds it, without the drafts, which check-dist holds it to.
check: export DRAFTS = 0
check: build check-dist typecheck test

check-dist:
	node scripts/check-dist.ts

# Every TypeScript project, checked (tsc only checks: esbuild, wrangler and node compile, or
# strip the types). Each has the globals it runs with: the browser's (tsconfig.json), each
# Worker's, their tests' (Node's too) and the Node scripts'.
TSCONFIGS = tsconfig.json site-worker/tsconfig.json site-worker/test/tsconfig.json \
	license-worker/tsconfig.json license-worker/test/tsconfig.json contact-worker/tsconfig.json \
	scripts/tsconfig.json
typecheck: workers
	@for p in $(TSCONFIGS); do echo "tsc -p $$p"; npx tsc -p $$p || exit 1; done

test: workers
	node --test site-worker/test/*.test.ts license-worker/test/*.test.ts scripts/*.test.ts
	python3 scripts/test_workflows.py

# The license server's tests, offline (license-worker/). CI deploys it on merge.
licenses-test: workers
	node --test license-worker/test/*.test.ts
