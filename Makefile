.PHONY: build run submodule worker

PORT ?= 8000

build:
	emacs -Q --batch index.org -f org-html-export-to-html

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
