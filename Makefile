.PHONY: build worker

build:
	emacs -Q --batch index.org -f org-html-export-to-html

worker:
	cd contact-worker && npx wrangler deploy
