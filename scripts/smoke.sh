#!/bin/sh
# After a deploy, ask the live site what a visitor gets: this build's pages, revalidated on
# every visit; a 404 for a path that names nothing; a video that seeks (206, Content-Range),
# from the edge cache once warm, and its HLS playlist readable by the player (CORS, which
# hls.js needs); and the license server's answers never cached. Run by
# deploy.yml after every deploy; anyone can run it (it needs public/ from the same build).
#
# The site's own pages and files are asked for with a nonce, ?probe=<commit>-<attempt>-<random>
# (as in ../merecatholicity.com): an address no cache has seen, so the answer is what the
# deploy serves. A hashed file (js/app.<hash>.js) is never asked for by its name here: browsers
# keep those for good, and the page naming this build's is the proof it is live.
set -eu
cd "$(dirname "$0")/.."
site=https://adamschaefers.com
fail() { echo "smoke: $*" >&2; exit 1; }
header() { printf '%s\n' "$1" | tr -d '\r' | grep -i "^$2:" | head -1; }
nonce="${GITHUB_SHA:-local}-${GITHUB_RUN_ATTEMPT:-0}-$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')"

# This build is the one served: the page names the same hashed app.js. A new version
# reaches every Cloudflare location within seconds; give it a minute.
want=$(grep -o 'js/app\.[0-9a-f]*\.js' public/index.html | head -1)
for i in $(seq 1 12); do
  got=$(curl -fsS "$site/?probe=$nonce-$i" | grep -o 'js/app\.[0-9a-f]*\.js' | head -1 || true)
  [ "$got" = "$want" ] && break
  [ "$i" = 12 ] && fail "/ still serves ${got:-nothing like js/app.<hash>.js}, not this build's $want"
  sleep 5
done

h=$(curl -fsSI "$site/?probe=$nonce") || fail "/ doesn't answer"
got=$(curl -fsS "$site/version.json?probe=$nonce") || fail "/version.json doesn't answer"
[ "$got" = "$(cat public/version.json)" ] || fail "/version.json is $got, not this build's $(cat public/version.json)"
header "$h" cache-control | grep -qi 'must-revalidate\|max-age=0\|no-cache' || fail "/ isn't revalidated: $(header "$h" cache-control)"
curl -fsS -o /dev/null "$site/store/?probe=$nonce" || fail "/store/ doesn't answer"
code=$(curl -s -o /dev/null -w '%{http_code}' "$site/no-such-page/?probe=$nonce")
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
  # Its HLS, when it has one: what the site's player streams (src/video.ts), from another origin.
  playlist="${video%.mp4}.m3u8"
  if grep -q "\"hls\":\"$playlist\"" public/index.html; then
    p=$(curl -sS -D - -o /dev/null -H "Origin: $site" "$playlist")
    printf '%s\n' "$p" | head -1 | grep -q ' 200' || fail "$playlist answered: $(printf '%s\n' "$p" | head -1)"
    header "$p" access-control-allow-origin | grep -q . || fail "$playlist has no Access-Control-Allow-Origin: hls.js can't read it"
  fi
fi

# GET, not HEAD: the license server answers its routes' methods only.
k=$(curl -fsS -D - -o /dev/null https://licenses.adamschaefers.com/v1/public-keys) || fail "the license server doesn't answer"
header "$k" cache-control | grep -qi no-store || fail "licenses /v1/public-keys isn't no-store"
header "$k" cf-cache-status | grep -qi hit && fail "licenses /v1/public-keys came from a cache"
echo "smoke: ok ($want live, version $(sed 's/.*"build":"\([0-9a-f]*\)".*/\1/' public/version.json); pages revalidate; video seeks and streams; license answers uncached)"
