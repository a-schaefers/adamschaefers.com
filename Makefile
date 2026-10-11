.PHONY: build run check licenses-test submodule

PORT ?= 8000

# The site: the Org export (site.el), then public/, exactly what the site serves
# (scripts/dist.sh). Neither is committed: CI builds and deploys them on every merge.
build:
	emacs -Q --batch -l site.el -f site-build
	sh scripts/dist.sh

# public/ served the way the site serves it (Workers Static Assets, locally), at
# http://localhost:8000. A make build in another terminal shows on the next reload.
run: build
	npx wrangler dev -c site-worker/wrangler.jsonc --port $(PORT)

# What CI's required check runs: the build, every link, the Workers' tests (offline), the
# workflows' rules.
check: build
	node scripts/check-dist.mjs
	node --test site-worker/test/*.test.js license-worker/test/*.test.js
	python3 scripts/test_workflows.py

# The license server's tests, offline (license-worker/). CI deploys it on merge.
licenses-test:
	node --test license-worker/test/*.test.js

# Clone the a-schaefers profile README into ./a-schaefers if it isn't there yet.
submodule:
	@if [ -e a-schaefers/.git ]; then \
		echo "a-schaefers already present"; \
	else \
		git submodule update --init a-schaefers; \
	fi
