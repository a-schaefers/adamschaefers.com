.PHONY: build workers run check check-dist typecheck test licenses-test

PORT ?= 8000

# The site: its script and styles compiled (scripts/build.ts: esbuild and Tailwind, into
# build/), the Org export (site.el), then public/, exactly what the site serves
# (scripts/dist.sh). None of it is committed: CI builds and deploys it on every merge.
build:
	node scripts/build.ts
	emacs -Q --batch -l site.el -f site-build
	sh scripts/dist.sh

# The Workers' admin pages, compiled into the modules they import (src/admin-page.gen.ts, which
# git ignores): the Workers' tests, tsc and wrangler need them. make build makes them too.
workers:
	node scripts/build.ts workers

# public/ served the way the site serves it (Workers Static Assets, locally), at
# http://localhost:8000. A make build in another terminal shows on the next reload.
run: build
	npx wrangler dev -c site-worker/wrangler.jsonc --port $(PORT)

# What CI's required check runs: the build, every link, the types, the Workers' tests
# (offline), the workflows' rules. (CI runs the two halves apart, uploading the site between
# them.)
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
	node --test site-worker/test/*.test.ts license-worker/test/*.test.ts
	python3 scripts/test_workflows.py

# The license server's tests, offline (license-worker/). CI deploys it on merge.
licenses-test: workers
	node --test license-worker/test/*.test.ts
