# The adamschaefers.com zone, the settings whose values are deliberate, tiered caching and bot
# management. Settings not listed here stay unmanaged and undisturbed.

resource "cloudflare_zone" "main" {
  account = {
    id = var.account_id
  }
  name                = "adamschaefers.com"
  paused              = false
  type                = "full"
  vanity_name_servers = []

  lifecycle {
    prevent_destroy = true
  }
}

# ssl=strict: the origin is the site Worker, which Cloudflare reaches on its own certificate.

resource "cloudflare_zone_setting" "ssl" {
  setting_id = "ssl"
  value      = "strict"
  zone_id    = var.zone_id
}

resource "cloudflare_zone_setting" "always_use_https" {
  setting_id = "always_use_https"
  value      = "on"
  zone_id    = var.zone_id
}

# Browser Cache TTL 0, "respect existing headers": the site Worker says how long each answer
# keeps (a hashed file for good, a page no longer than its revalidation).

resource "cloudflare_zone_setting" "browser_cache_ttl" {
  setting_id = "browser_cache_ttl"
  value      = 0
  zone_id    = var.zone_id
}

# Smart Tiered Cache on (and tiered caching under it): the edge asks a nearer data center
# before the origin. Set by hand until 2026-10-12, now held here.

resource "cloudflare_tiered_cache" "main" {
  value   = "on"
  zone_id = var.zone_id
}

resource "cloudflare_argo_tiered_caching" "main" {
  value   = "on"
  zone_id = var.zone_id
}

resource "cloudflare_bot_management" "main" {
  ai_bots_protection      = "disabled"
  content_bots_protection = "disabled"
  crawler_protection      = "disabled"
  enable_js               = false
  fight_mode              = false
  is_robots_txt_managed   = false
  zone_id                 = var.zone_id
}
