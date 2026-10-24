#!/bin/sh
# Assemble public/, exactly what the site serves: the site Worker's static assets
# (site-worker/wrangler.jsonc). make build runs this after the Org export.
#
# From build/: what site.el wrote (index.html, 404.html, the feed, the sitemap, and every
# page in share-pages.txt), and the styles and scripts scripts/build.ts compiled, under the
# hashed names pages load them by (assets.txt: the script with its source map, and the
# fonts, from their npm packages). From the repository: static/, served as it is at the
# site root (images, me.jpeg, robots.txt; not its README), and every tracked file under
# content/ that isn't Org (a travelog's poster, an entry's own files), at its path under
# the site root (content/off-the-clock/evia.jpg at /off-the-clock/evia.jpg), but a drafts/ folder's
# only when the build has drafts (site.el lists them in build/drafts.txt: a local build, never CI's),
# and never its .KEEP. Nothing else: the TypeScript,
# node_modules, the Org sources, the Workers, the scripts and the docs stay out. Videos and uploads live in R2
# (media.adamschaefers.com), not here. Then _redirects, a _headers that keeps every
# hashed file for good, and version.json: the hashes of the script and styles pages load,
# which src/version.ts asks to learn whether an open tab is behind a deploy. Pages, the
# feed and version.json revalidate on every request (the default, _headers' first rule).
# scripts/check-dist.ts fails on any link this leaves dangling.
#
# It is assembled in build/dist/, and public/ then takes it in place, never deleted and
# remade: wrangler dev (make run) watches public/, and stops seeing changes for good once
# that folder is deleted.
set -eu
cd "$(dirname "$0")/.."

out=build/dist
rm -rf "$out"
mkdir -p "$out"
copy() { # copy FILE [NAME]: FILE into the assembly as NAME (default FILE)
  if [ ! -f "$1" ]; then
    echo "dist: $1 is missing (run make build)" >&2
    exit 1
  fi
  mkdir -p "$out/$(dirname "${2:-$1}")"
  cp "$1" "$out/${2:-$1}"
}

for f in index.html 404.html rss.xml sitemap.xml $(cat build/share-pages.txt); do copy "build/$f" "$f"; done
git ls-files -- static ':(exclude)*.md' | while read -r f; do copy "$f" "${f#static/}"; done
# A draft's pictures, in its drafts/ folder, only beside the drafts themselves.
drafts=":(exclude)content/*/drafts/**"
[ ! -s build/drafts.txt ] || drafts=":(exclude)content/*/drafts/.KEEP"
git ls-files -- content ':(exclude)*.org' "$drafts" | while read -r f; do copy "$f" "${f#content/}"; done
while read -r file hashed; do
  copy "$file" "$hashed"
  # A source map keeps its plain name beside the hashed file (the name the file gives it).
  [ ! -f "$file.map" ] || copy "$file.map" "$(dirname "$hashed")/$(basename "$file").map"
done < build/assets.txt

cp site-worker/_redirects "$out/_redirects"
{
  cat site-worker/_headers
  while read -r file hashed; do
    printf '\n/%s\n  Cache-Control: public, max-age=31536000, immutable\n' "$hashed"
  done < build/assets.txt
} > "$out/_headers"
# {"build": <12 hex of the hashed names>, "assets": {"app.js": <hash>, "site.css": <hash>}}: the two
# every page loads (js/hls.<hash>.js, which src/video.ts imports when it needs it, isn't one).
assets=$(sed -n 's#^[^ ]* \(js/\)\{0,1\}\(app\|site\)\.\([0-9a-f]\{10\}\)\.\(js\|css\)$#"\2.\4":"\3"#p' build/assets.txt | paste -sd, -)
build=$(cut -d' ' -f2 build/assets.txt | sort | sha256sum | cut -c1-12)
printf '{"build":"%s","assets":{%s}}\n' "$build" "$assets" > "$out/version.json"
# Into public/: new and changed files first and the pages last, so no page names a file
# that isn't there yet; then what this build no longer has goes.
mkdir -p public
update() { # update FIND-TEST...: the assembled files passing the test, where public/ differs
  (cd "$out" && find . -type f "$@") | while read -r f; do
    if ! cmp -s "$out/$f" "public/$f"; then
      mkdir -p "public/$(dirname "$f")"
      cp "$out/$f" "public/$f"
    fi
  done
}
update ! -name '*.html'
update -name '*.html'
(cd public && find . ! -type d) | while read -r f; do [ -f "$out/$f" ] || rm "public/$f"; done
find public -mindepth 1 -type d -empty -delete
echo "dist: $(find public -type f ! -name '_*' | wc -l) files in public/ (version $build)"
