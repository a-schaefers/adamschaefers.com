.PHONY: build run submodule worker licenses licenses-test

PORT ?= 8000

build:
	emacs -Q --batch -l site.el -f site-build

run:
	python3 -m http.server $(PORT)

# Clone the a-schaefers profile README into ./a-schaefers if it isn't there yet.
submodule:
	@if [ -e a-schaefers/.git ]; then \
		echo "a-schaefers already present"; \
	else \
		git submodule update --init a-schaefers; \
	fi

worker:
	cd contact-worker && npx wrangler deploy

# The license server (license-worker/): its tests (offline), then a deploy. Live: real money.
licenses-test:
	cd license-worker && node --test test/*.test.js

licenses: licenses-test
	cd license-worker && npx wrangler deploy
