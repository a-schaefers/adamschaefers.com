# Credentials come from the environment ONLY, never from a file in this repo:
#   CLOUDFLARE_API_TOKEN  - the account token the three sites share (README.md)
#   GITHUB_TOKEN          - a token with admin on the owner's two repositories
#
# The backend additionally needs the R2 S3 credentials, derived from the Cloudflare
# token (README.md): AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY

provider "cloudflare" {}

provider "github" {
  owner = var.github_owner
}
