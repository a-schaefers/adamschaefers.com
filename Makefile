.PHONY: build

build:
	emacs -Q --batch index.org -f org-html-export-to-html
