#!/bin/sh
# After a deploy, ask the live site what a visitor gets: this build's pages, revalidated on
# every visit; a 404 for a path that names nothing; a video that seeks (206, Content-Range),
# from the edge cache once warm; and the license server's answers never cached. Run by
# deploy.yml after every deploy; anyone can run it (it needs public/ from the same build).
set -eu
cd "$(dirname "$0")/.."
site=https://adamschaefers.com
fail() { echo "smoke: $*" >&2; exit 1; }
header() { printf '%s\n' "$1" | tr -d '\r' | grep -i "^$2:" | head -1; }

# This build is the one served: the page names the same hashed app.js. A new version
# reaches every Cloudflare location within seconds; give it a minute.
want=$(grep -o 'js/app\.[0-9a-f]*\.js' public/index.html | head -1)
for i in $(seq 1 12); do
  got=$(curl -fsS "$site/" | grep -o 'js/app\.[0-9a-f]*\.js' | head -1 || true)
  [ "$got" = "$want" ] && break
  [ "$i" = 12 ] && fail "/ still serves ${got:-nothing like js/app.<hash>.js}, not this build's $want"
  sleep 5
done

h=$(curl -fsSI "$site/") || fail "/ doesn't answer"
header "$h" cache-control | grep -qi 'must-revalidate\|max-age=0\|no-cache' || fail "/ isn't revalidated: $(header "$h" cache-control)"
curl -fsS -o /dev/null "$site/store/" || fail "/store/ doesn't answer"
code=$(curl -s -o /dev/null -w '%{http_code}' "$site/no-such-page/")
[ "$code" = 404 ] || fail "/no-such-page/ answered $code, not 404"
code=$(curl -s -o /dev/null -w '%{http_code}' "$site/admin/")
[ "$code" != 200 ] || fail "/admin/ answered 200 without Cloudflare Access"

video=$(grep -o 'enclosure url="[^"]*"' public/rss.xml | head -1 | cut -d'"' -f2)
if [ -n "$video" ]; then
  v=$(curl -sS -D - -o /dev/null -H 'Range: bytes=0-1' "$video")
  printf '%s\n' "$v" | head -1 | grep -q ' 206' || fail "$video with a Range answered: $(printf '%s\n' "$v" | head -1)"
  header "$v" content-range | grep -qi 'bytes 0-1/' || fail "$video has no Content-Range"
  again=$(curl -sS -D - -o /dev/null -H 'Range: bytes=0-1' "$video")
  header "$again" cf-cache-status | grep -qi hit ||
    echo "smoke: note: $video's second read was $(header "$again" cf-cache-status || echo 'not cached'), not a HIT"
fi

# GET, not HEAD: the license server answers its routes' methods only.
k=$(curl -fsS -D - -o /dev/null https://licenses.adamschaefers.com/v1/public-keys) || fail "the license server doesn't answer"
header "$k" cache-control | grep -qi no-store || fail "licenses /v1/public-keys isn't no-store"
header "$k" cf-cache-status | grep -qi hit && fail "licenses /v1/public-keys came from a cache"
echo "smoke: ok ($want live; pages revalidate; video seeks; license answers uncached)"
