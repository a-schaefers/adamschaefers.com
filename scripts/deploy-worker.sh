#!/bin/sh
# Deploy a Worker from CI when anything it is built from changed since its live version:
# its folder, or the pinned wrangler (package-lock.json). The live version's tag names the
# commit it came from (scripts/deployed.ts); a version without one is always replaced.
#
#   scripts/deploy-worker.sh <folder> <worker name>    (CI's deploy job: the token is set)
set -eu
dir=$1
name=$2
live=$(node scripts/deployed.ts "$name")
if [ -n "$live" ] && git cat-file -e "$live^{commit}" 2>/dev/null &&
   git diff --quiet "$live" HEAD -- "$dir" package-lock.json; then
  echo "$name: live at ${live%"${live#???????}"}, nothing of it changed since"
  exit 0
fi
echo "$name: deploying (live: ${live:-untagged})"
npx wrangler deploy -c "$dir/wrangler.jsonc" --tag "$(git rev-parse HEAD)" --message "$(git log -1 --format=%s | cut -c1-100)"
