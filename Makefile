.PHONY: build run submodule worker

build:
	emacs -Q --batch index.org -f org-html-export-to-html

run:
	python3 -m http.server 8000

# Clone the a-schaefers profile README into ./a-schaefers if it isn't there yet.
submodule:
	@if [ -e a-schaefers/.git ]; then \
		echo "a-schaefers already present"; \
	else \
		git submodule update --init a-schaefers; \
	fi

worker:
	cd contact-worker && npx wrangler deploy
