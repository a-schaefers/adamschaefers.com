#!/bin/sh
# Assemble public/, exactly what the site serves: the site Worker's static assets
# (site-worker/wrangler.jsonc). make build runs this after the Org export.
#
# What the build wrote (index.html, 404.html, the feed, the sitemap, and every page in
# share-pages.txt); the styles and scripts under the hashed names pages load them by
# (assets.txt, with the lit modules' source maps); and the tracked files pages link to:
# images, fonts, posters, an entry's own files. Nothing else: the rest of the vendored lit,
# the Org sources, the Workers, the scripts and the docs stay out. Videos and uploads live
# in R2 (media.adamschaefers.com), not here. Then _redirects, and a _headers that keeps
# every hashed file for good. scripts/check-dist.mjs fails on any link this leaves dangling.
set -eu
cd "$(dirname "$0")/.."

rm -rf public
mkdir public
copy() { # copy FILE [NAME]: FILE into public/ as NAME (default FILE)
  if [ ! -f "$1" ]; then
    echo "dist: $1 is missing (run make build)" >&2
    exit 1
  fi
  mkdir -p "public/$(dirname "${2:-$1}")"
  cp "$1" "public/${2:-$1}"
}

for f in index.html 404.html rss.xml sitemap.xml $(cat share-pages.txt); do copy "$f"; done
git ls-files -- robots.txt me.jpeg images 'fonts/*.woff2' 'videos/*.jpg' blog off-the-clock ':(exclude)*.org' |
  while read -r f; do copy "$f"; done
while read -r file hashed; do
  copy "$file" "$hashed"
  case "$file" in js/lit/*) [ ! -f "$file.map" ] || copy "$file.map" ;; esac
done < assets.txt

cp site-worker/_redirects public/_redirects
{
  cat site-worker/_headers
  while read -r file hashed; do
    printf '\n/%s\n  Cache-Control: public, max-age=31536000, immutable\n' "$hashed"
  done < assets.txt
} > public/_headers
echo "dist: $(find public -type f ! -name '_*' | wc -l) files in public/"
