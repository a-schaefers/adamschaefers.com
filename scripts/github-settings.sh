#!/bin/sh
# Repo settings for adamschaefers.com and enchant.games, applied with gh.
#
#   scripts/github-settings.sh apply [owner/repo ...]
#   scripts/github-settings.sh check [owner/repo ...]
#
# With no repos it covers both. apply is safe to re-run: it updates the
# ruleset in place. What it sets:
#   - master accepts changes only through pull requests (no direct pushes,
#     no force-pushes, no deletion), for everyone including admins;
#   - PRs need no approving review, so your own PRs can merge themselves;
#   - auto-merge is allowed and merged branches are deleted.
set -eu

RULESET='master: pull requests only'
DEFAULT_REPOS='a-schaefers/adamschaefers.com LandOfEnchantment/enchant.games'

ruleset_id() {
	gh api "repos/$1/rulesets" --jq ".[] | select(.name == \"$RULESET\") | .id"
}

ruleset_json() {
	cat <<JSON
{
  "name": "$RULESET",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } }
  ]
}
JSON
}

apply() {
	repo=$1
	gh api -X PATCH "repos/$repo" -F allow_auto_merge=true -F delete_branch_on_merge=true >/dev/null
	id=$(ruleset_id "$repo")
	if [ -n "$id" ]; then
		ruleset_json | gh api -X PUT "repos/$repo/rulesets/$id" --input - >/dev/null
	else
		ruleset_json | gh api -X POST "repos/$repo/rulesets" --input - >/dev/null
	fi
	echo "$repo: applied"
}

check() {
	repo=$1
	ok=1
	settings=$(gh api "repos/$repo" --jq '"\(.allow_auto_merge) \(.delete_branch_on_merge)"')
	[ "$settings" = "true true" ] || { echo "$repo: auto-merge/branch deletion off ($settings)"; ok=0; }
	id=$(ruleset_id "$repo")
	if [ -z "$id" ]; then
		echo "$repo: ruleset '$RULESET' missing"; ok=0
	else
		state=$(gh api "repos/$repo/rulesets/$id" --jq '.enforcement')
		[ "$state" = active ] || { echo "$repo: ruleset is $state, not active"; ok=0; }
	fi
	[ $ok = 1 ] && echo "$repo: ok"
	[ $ok = 1 ]
}

cmd=${1:-}
[ $# -gt 0 ] && shift
repos=${*:-$DEFAULT_REPOS}
case $cmd in
	apply) for r in $repos; do apply "$r"; done ;;
	check) status=0; for r in $repos; do check "$r" || status=1; done; exit $status ;;
	*) echo "usage: $0 apply|check [owner/repo ...]" >&2; exit 2 ;;
esac
