# Terraform: the durable infrastructure

The parts of adamschaefers.com that outlive a deploy, as code: the GitHub repositories'
settings and the Cloudflare zone's configuration. The same system as
../merecatholicity.com's `terraform/` (its README is the long form) and ../enchant.games'.
It is adoption-only: everything here already existed and was imported on 2026-10-12.
Terraform did not create the site.

## What Terraform owns, and what it must not touch

**Terraform owns** (`terraform state list`, 45 resources): the zone, its three deliberate
settings (SSL strict, Always Use HTTPS, Browser Cache TTL 0), Smart Tiered Cache and the
tiered caching under it, and bot management; all 16 DNS records; the license store's rate
limiting rule; both Turnstile widgets (the contact form's and the store's); the license
server's D1 database *as a record that it exists*; the `adamschaefers-media` bucket and
this state's own bucket, each with its r2.dev switch (off); the two Access applications
in front of the admin pages; and on GitHub this repository (its ruleset, the workflow
token's rights, the allowed actions, Dependabot, the `production` and
`terraform-production` environments, the account and zone id variables). The private
backups repository `adamschaefers.com-private`, which held the license server's secrets, is
forgotten (the `removed` block in `github.tf`, 2026-10-13): no repository holds a secret.

**wrangler owns** the three Workers (`site-worker/`, `license-worker/`,
`contact-worker/`): their scripts, routes, custom domains, bindings, vars, secrets and D1
migrations. `wrangler deploy` rewrites those on every deploy; were Terraform to declare
them too, the two would fight forever. The custom domains' DNS records (contact-api,
licenses) are declared here, as ../merecatholicity.com declares its own, so a record
changed by hand shows in the plan. **deploy.yml owns** what the site Worker serves.

**No other project's Terraform owns anything here, and this one owns nothing of
theirs.** The three sites share one Cloudflare account and one owner on GitHub, so this
is the line that keeps an apply in one from becoming drift in another:

- ../merecatholicity.com's: its zone, its repositories, and its own buckets, databases
  and widgets.
- ../enchant.games': its zone, its repository and the LandOfEnchantment organization's
  workflow setting, and its own widget, database and state bucket.
- Nothing of one site serves another: until 2026-10-12 enchant.games' Press page posted to
  the contact Worker here with this site's widget; it has its own of both now.
- Nobody's: the account itself, its API tokens, its Email Routing destination address,
  its Zero Trust organization (identity providers, the WARP login app), and every zone
  and widget of the account's other sites.

On 2026-10-12 the three states held 153 resources with no object in two of them. Before
adopting anything account-wide (a widget, a bucket, a database, an Access app), make sure
no other project's state holds it (`terraform state list` there).

## Running from CI

`.github/workflows/terraform.yml`, as merecatholicity.com's: every pull request gets
`fmt` and an offline `validate` with no credentials; a merge that changes `terraform/`
(or a run by hand) plans with them, and when the plan has changes, `apply` waits on the
`terraform-production` environment for the owner's review: *Review deployments* on the
run, or `scripts/ci_approve.sh <run-id> --approve`, the same API call. An "Approval
needed" issue names the wait (`scripts/ci_ask_review.sh`), because GitHub tells nobody of
their own run.

This repository is public, so its logs and artifacts are: the workflow never prints a plan
or an apply (both go to files on the runner; a failure shows only its `Error:` lines),
never uploads the plan file (it embeds the prior state), and shows reviewers only
`scripts/tf_plan_summary.py`'s summary: addresses, actions, changed attribute names, and
values only where the provider does not mark them sensitive. It refuses a plan that
destroys or replaces unless run by hand with `allow_destroy=true`, and the apply job
re-plans and refuses if the plan differs from the one reviewed. `scripts/test_workflows.py`
holds the workflow to all of that.

**No pull request ever sees a secret**: a PR's HCL is what `plan` evaluates, and a data
source in it could read the tokens before any gate. Every secret reference is blanked on a
`pull_request` event in its own expression, and a fork's run waits for the owner first.

**Secrets** (repository Actions secrets, set by hand; never managed here):

- `CLOUDFLARE_ROOT_TOKEN`: the account token the three sites share (the owner's choice:
  one hobby account, one token). Its value is `CLOUDFLARE_ROOT_TOKEN` in
  `~/.config/merecatholicity/ci.env`, also this repository's `production` secret
  `CLOUDFLARE_PURGE_TOKEN` and the site Worker's `PURGE_TOKEN`. The state backend's S3
  pair is derived from it on every run (key = the token's id, secret = SHA-256 of its
  value), so a rotation carries the backend along. Rotate: `.claude/rules/cicd.md`,
  Credentials.
- `GH_ROOT_TOKEN`: a classic personal access token, minted by the owner on 2026-10-12, no
  expiry, shared with ../enchant.games' pipeline; its copy is
  `~/.config/hobby/github-token`. merecatholicity.com keeps its own. Rotate: a new token
  into that file, then `gh secret set GH_ROOT_TOKEN < ~/.config/hobby/github-token` in
  both repositories.

## What Terraform cannot hold

- **A fork's workflows waiting for approval every time** (`all_external_contributors`):
  the GitHub provider has no resource for it. It is set, and stays set by hand:
  `gh api -X PUT repos/a-schaefers/adamschaefers.com/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors`.
- **GitHub Pages staying off**: Cloudflare serves the site; an absence has nothing to
  declare.
- **The Access applications' policy** ("Adam only"): an app-scoped policy of the older
  kind; provider 5.24.0's policy resource reads only the reusable kind. The applications
  are here and name it by id; its rules are not.
- **The media bucket's custom-domain binding** (media.adamschaefers.com): the provider
  cannot import `cloudflare_r2_custom_domain`. Its DNS record is here.
- **Email Routing's settings object**: provider 5.24.0 cannot read it (merecatholicity.com's
  README has the error). Its only rule is the default catch-all (disabled), likewise left
  alone; the records it depends on (three MX, SPF, DKIM, DMARC) are here.
- **The buckets' r2.dev switches cannot be imported**: they were adopted by a create,
  which is a PUT of the switch to the value it already had (off).

## State

In R2 at `adamschaefers-tfstate/adamschaefers.com/terraform.tfstate`. The bucket was made
by hand before the first `init` (a backend cannot create its own store) and is imported
here with `prevent_destroy`; were it ever lost, make it by hand again, then `init` and
import. **State is secret**: it holds both Turnstile widgets' secrets. `.gitignore` keeps
every `*.tfstate*`, plan and generated file out of git; do not defeat it.

## Working here

```sh
export CLOUDFLARE_API_TOKEN=…                      # ci.env's CLOUDFLARE_ROOT_TOKEN
export GITHUB_TOKEN=$(cat ~/.config/hobby/github-token)
export AWS_ACCESS_KEY_ID=$(curl -fsS https://api.cloudflare.com/client/v4/accounts/6093bc0889c95a08f0a92a8df6750c66/tokens/verify \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r .result.id)
export AWS_SECRET_ACCESS_KEY=$(printf %s "$CLOUDFLARE_API_TOKEN" | sha256sum | cut -d' ' -f1)
terraform -chdir=terraform init
terraform -chdir=terraform plan          # expect: No changes
```

A change is a pull request like any other: edit, plan locally, ship; the merge's run plans
again and waits for the owner's review before it applies. Adopting something that exists:
an import block in `imports.tf` with its live id, `plan -generate-config-out=generated.tf`,
fold that into the topic file, delete it, and plan until only the import remains.

**Never apply a plan that shows a destroy or a replace.** A replaced D1 database is the
license server's records, gone; a replaced bucket is the media or this state, gone.
