# The media bucket (media.adamschaefers.com; its custom-domain binding cannot be imported, its
# DNS record is in dns.tf) and the bucket this configuration's own state lives in (versions.tf),
# made by hand before the first init and imported here: prevent_destroy on both, and the
# pipeline refuses any destroy.

resource "cloudflare_r2_bucket" "media" {
  account_id    = var.account_id
  jurisdiction  = "default"
  location      = "WNAM"
  name          = "adamschaefers-media"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "tfstate" {
  account_id    = var.account_id
  jurisdiction  = "default"
  location      = "WNAM"
  name          = "adamschaefers-tfstate"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

# Each bucket's public r2.dev URL: OFF, and declared so a door opened by hand shows as drift.
# State holds secrets; the media bucket has its custom domain. Provider 5.24.0 cannot import
# this resource: its create is a PUT of the switch, so adoption is a create (two no-ops: both
# were off).
locals {
  r2_dev_url_off = {
    media   = cloudflare_r2_bucket.media.name
    tfstate = cloudflare_r2_bucket.tfstate.name
  }
}

resource "cloudflare_r2_managed_domain" "dev_url" {
  for_each    = local.r2_dev_url_off
  account_id  = var.account_id
  bucket_name = each.value
  enabled     = false
}
