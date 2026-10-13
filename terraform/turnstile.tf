# This site's two widgets; each Worker holds its widget's secret as a Worker secret. The contact
# form's served ../enchant.games' Press page too until 2026-10-12, when that site got its own
# widget and Worker; now it is this site's alone.

resource "cloudflare_turnstile_widget" "contact" {
  account_id      = var.account_id
  bot_fight_mode  = false
  clearance_level = "no_clearance"
  domains         = ["adamschaefers.com"]
  ephemeral_id    = false
  mode            = "managed"
  name            = "adamschaefers contact form"
  offlabel        = false
  region          = "world"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_turnstile_widget" "store" {
  account_id      = var.account_id
  bot_fight_mode  = false
  clearance_level = "no_clearance"
  domains         = ["adamschaefers.com"]
  ephemeral_id    = false
  mode            = "managed"
  name            = "adamschaefers store"
  offlabel        = false
  region          = "world"

  lifecycle {
    prevent_destroy = true
  }
}
