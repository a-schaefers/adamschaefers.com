#!/bin/sh
# The book as a PDF: make pdf. Run by hand when the book changes, never by make build,
# make run or CI: the site only serves the file this leaves in content/, committed like a
# post's picture. While the book is a draft (in content/blog/drafts/) nothing is left in
# content/: both editions stay in build/pdf/, and the site has no PDF.
#
# Org to LaTeX to PDF. Emacs exports the post the site is built from (scripts/pdf.el:
# its text as build/pdf/body.tex), and pdflatex sets it in the book's frame
# (scripts/pdf.tex), each note at the foot of the page that refers to it. Two editions:
#
#   content/blog/<name>.pdf        the one the post links to, at /blog/<name>.pdf
#   build/pdf/<name>-paperback.pdf the interior to upload to Kindle Direct Publishing
#
# <name> is the post's file name without its date. It needs Emacs and TeX Live (pdflatex
# with mathpazo, microtype, titlesec, footmisc and hyperref: Arch's texlive-latexextra and
# texlive-fontsrecommended, Debian's texlive-latex-extra and texlive-fonts-recommended).
# The same sources and the same TeX Live give the same bytes: every date in the file is
# the post's own (SOURCE_DATE_EPOCH).
set -eu
cd "$(dirname "$0")/.."

book=2026-11-05-machines-of-borrowed-grace.org
if [ $# -gt 0 ]; then src=$1
elif [ -f "content/blog/$book" ]; then src=content/blog/$book
else src=content/blog/drafts/$book
fi
base=$(basename "$src" .org)
date=$(printf '%s' "$base" | cut -c1-10)
name=$(printf '%s' "$base" | cut -c12-)
out=build/pdf
mkdir -p "$out"

emacs -Q --batch -l scripts/pdf.el --eval "(pdf-export \"$src\" \"$out\")"
cp scripts/pdf.tex "$out/frame.tex"

SOURCE_DATE_EPOCH=$(date -u -d "$date" +%s)
export SOURCE_DATE_EPOCH
set_pdf() { # set_pdf JOBNAME TEX: three runs, for the contents' pages and the notes' numbers
  for run in 1 2 3; do
    if ! (cd "$out" && pdflatex -interaction=nonstopmode -halt-on-error -jobname="$1" "$2" > "$1.run" 2>&1); then
      tail -30 "$out/$1.run" >&2
      echo "pdf: pdflatex failed, the whole log is $out/$1.log" >&2
      exit 1
    fi
  done
  if grep -q 'Rerun to get\|undefined references' "$out/$1.log"; then
    echo "pdf: $1 still has references to settle, see $out/$1.log" >&2
    exit 1
  fi
}
set_pdf "$name" '\input{frame.tex}'
set_pdf "$name-paperback" '\def\PAPERBACK{1}\input{frame.tex}'

pages() { pdfinfo "$1" 2>/dev/null | awk '/^Pages/{print $2}'; }
case "$src" in
  */drafts/*) echo "pdf: $out/$name.pdf ($(pages "$out/$name.pdf") pages; the book is a draft, so content/ gets no PDF)" ;;
  *)
    cp "$out/$name.pdf" "$(dirname "$src")/$name.pdf"
    echo "pdf: $(dirname "$src")/$name.pdf ($(pages "$out/$name.pdf") pages)" ;;
esac
echo "pdf: $out/$name-paperback.pdf ($(pages "$out/$name-paperback.pdf") pages, for Kindle Direct Publishing)"
