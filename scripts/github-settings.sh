#!/usr/bin/env bash
# The repository's GitHub settings, kept in git (2026-10-11, as in ../backseat-driver).
# Settings clicked by hand drift; these are applied from here and checked from here.
#
#   scripts/github-settings.sh check    say what differs from this file (read only)
#   scripts/github-settings.sh apply    make GitHub match it
#
# Needs `gh` logged in as the repository's admin. REPO overrides the target.
#
# What it holds:
#   - master's ruleset (.github/rulesets/master.json): no direct push, no force push,
#     no deletion; a pull request with `check` green (from GitHub Actions only)
#     and one approval, stale approvals dismissed. No bypass actor: the owner
#     and every agent get the same rule. owner-merge.yml approves the owner's
#     pull requests; anyone else's waits for the owner.
#   - Actions may approve pull requests (owner-merge.yml's approval), and the
#     default token is read only (each workflow asks for what it needs).
#   - Auto-merge allowed, merge commits allowed, a branch deleted when merged,
#     an out-of-date branch can be updated from the pull request.
#   - Only GitHub-owned and verified actions run, each pinned to a commit.
#   - A fork's workflows wait for approval every time, not only the first.
#   - Secret scanning with push protection; Dependabot alerts and fixes.
#   - The `production` environment, which only master may deploy from: it holds the
#     Cloudflare token (CLOUDFLARE_API_TOKEN, set by hand: gh secret set CLOUDFLARE_API_TOKEN
#     --env production). The account id is a repository variable (not a secret).
#   - GitHub Pages off: Cloudflare serves the site (site-worker/).
#
# The emergency door: when the check itself is broken and its fix cannot pass
# it, the owner sets the ruleset's enforcement to disabled (Settings → Rules,
# or edit the JSON's "enforcement" and apply), merges the fix, and sets it back
# (`check` here shows the drift if that is forgotten). Never a bypass actor.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
repo=${REPO:-a-schaefers/adamschaefers.com}
ruleset=.github/rulesets/master.json
account_id=6093bc0889c95a08f0a92a8df6750c66
mode=${1:-}
case "$mode" in
  check|apply) ;;
  *) sed -n '2,10p' "$0"; exit 64 ;;
esac

repo_settings='{
  "allow_auto_merge": true,
  "allow_merge_commit": true,
  "delete_branch_on_merge": true,
  "allow_update_branch": true,
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}'
workflow_permissions='{ "default_workflow_permissions": "read", "can_approve_pull_request_reviews": true }'
actions_permissions='{ "enabled": true, "allowed_actions": "selected", "sha_pinning_required": true }'
selected_actions='{ "github_owned_allowed": true, "verified_allowed": true, "patterns_allowed": [] }'
fork_approval='{ "approval_policy": "all_external_contributors" }'
environment='{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }'

drift=0
# Whether every value WANT names is in GOT (objects by key, arrays by place;
# GitHub answers with more fields than it was given).
subset='def sub($g): if type == "object" then ($g | type) == "object" and
    (to_entries | all(.key as $k | .value | sub($g[$k])))
  elif type == "array" then ($g | type) == "array" and length == ($g | length) and
    (. as $w | [range(length)] | all(. as $i | $w[$i] | sub($g[$i])))
  else . == $g end;'
# same NAME WANT GOT
same() {
  if jq -e --argjson got "$3" "$subset sub(\$got)" <<<"$2" >/dev/null; then
    echo "ok     $1"
  else
    echo "DRIFT  $1"
    echo "       want $(jq -cS . <<<"$2")"
    echo "       have $(jq -cS --argjson w "$2" 'with_entries(select(.key as $k | $w | has($k)))' <<<"$3")"
    drift=1
  fi
}
put() { gh api -X "$1" "$2" --input - <<<"$3" >/dev/null && echo "set    $2"; }

name=$(jq -r .name "$ruleset")
id=$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")

if [ "$mode" = check ]; then
  same "repository" "$(jq -c 'del(.security_and_analysis)' <<<"$repo_settings")" "$(gh api "repos/$repo")"
  same "secret scanning" "$(jq -c .security_and_analysis <<<"$repo_settings")" \
    "$(gh api "repos/$repo" --jq '.security_and_analysis | {secret_scanning: {status: .secret_scanning.status}, secret_scanning_push_protection: {status: .secret_scanning_push_protection.status}}')"
  same "workflow token" "$workflow_permissions" "$(gh api "repos/$repo/actions/permissions/workflow")"
  same "actions allowed" "$actions_permissions" "$(gh api "repos/$repo/actions/permissions")"
  same "selected actions" "$selected_actions" "$(gh api "repos/$repo/actions/permissions/selected-actions")"
  same "fork approval" "$fork_approval" "$(gh api "repos/$repo/actions/permissions/fork-pr-contributor-approval")"
  if gh api "repos/$repo/vulnerability-alerts" --silent 2>/dev/null; then echo "ok     dependabot alerts"
  else echo "DRIFT  dependabot alerts are off"; drift=1; fi
  same "dependabot fixes" '{"enabled": true}' "$(gh api "repos/$repo/automated-security-fixes")"
  if gh api "repos/$repo/environments/production" --silent 2>/dev/null; then
    same "production environment" "$environment" "$(gh api "repos/$repo/environments/production" --jq '{deployment_branch_policy}')"
    same "production deploys from" '["master"]' "$(gh api "repos/$repo/environments/production/deployment-branch-policies" --jq '[.branch_policies[].name]')"
    if gh api "repos/$repo/environments/production/secrets/CLOUDFLARE_API_TOKEN" --silent 2>/dev/null; then echo "ok     production has CLOUDFLARE_API_TOKEN"
    else echo "DRIFT  production has no CLOUDFLARE_API_TOKEN (gh secret set CLOUDFLARE_API_TOKEN --env production)"; drift=1; fi
  else
    echo "DRIFT  no production environment"; drift=1
  fi
  same "variables" "{\"value\": \"$account_id\"}" "$(gh api "repos/$repo/actions/variables/CLOUDFLARE_ACCOUNT_ID" 2>/dev/null || echo '{}')"
  if gh api "repos/$repo/pages" --silent 2>/dev/null; then echo "DRIFT  GitHub Pages is on"; drift=1; else echo "ok     GitHub Pages is off"; fi
  if [ -z "$id" ]; then
    echo "DRIFT  ruleset \"$name\" does not exist"; drift=1
  else
    # rules keyed by type: GitHub need not answer them in the order given
    keyed='{name, target, enforcement, conditions, bypass_actors: (.bypass_actors // []),
            rules: (.rules | map({key: .type, value: .}) | from_entries)}'
    same "ruleset" "$(jq -c "$keyed" "$ruleset")" "$(gh api "repos/$repo/rulesets/$id" | jq -c "$keyed")"
  fi
  [ "$drift" = 0 ] && echo "GitHub matches $0" || echo "GitHub differs: scripts/github-settings.sh apply"
  exit "$drift"
fi

# apply. The workflow token's right to approve goes first: once the ruleset
# wants an approval, the owner's pull requests need owner-merge.yml's.
put PUT "repos/$repo/actions/permissions/workflow" "$workflow_permissions"
put PATCH "repos/$repo" "$repo_settings"
put PUT "repos/$repo/actions/permissions" "$actions_permissions"
put PUT "repos/$repo/actions/permissions/selected-actions" "$selected_actions"
put PUT "repos/$repo/actions/permissions/fork-pr-contributor-approval" "$fork_approval"
gh api -X PUT "repos/$repo/vulnerability-alerts" --silent && echo "set    repos/$repo/vulnerability-alerts"
gh api -X PUT "repos/$repo/automated-security-fixes" --silent && echo "set    repos/$repo/automated-security-fixes"
put PUT "repos/$repo/environments/production" "$environment"
if ! gh api "repos/$repo/environments/production/deployment-branch-policies" --jq '.branch_policies[].name' | grep -qx master; then
  put POST "repos/$repo/environments/production/deployment-branch-policies" '{ "name": "master", "type": "branch" }'
fi
gh variable set CLOUDFLARE_ACCOUNT_ID --repo "$repo" --body "$account_id" && echo "set    variable CLOUDFLARE_ACCOUNT_ID"
if gh api "repos/$repo/pages" --silent 2>/dev/null; then
  gh api -X DELETE "repos/$repo/pages" --silent && echo "set    GitHub Pages off"
fi
if [ -z "$id" ]; then
  put POST "repos/$repo/rulesets" "$(cat "$ruleset")"
else
  put PUT "repos/$repo/rulesets/$id" "$(cat "$ruleset")"
fi
echo "applied; scripts/github-settings.sh check reads it back"
