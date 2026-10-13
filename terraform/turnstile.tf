# This site's two widgets; each Worker holds its widget's secret as a Worker secret. The contact
# form's also serves ../enchant.games' Press page (its domains name enchant.games): it is
# this project's, and enchant.games' Terraform must never declare it.

resource "cloudflare_turnstile_widget" "contact" {
  account_id      = var.account_id
  bot_fight_mode  = false
  clearance_level = "no_clearance"
  domains         = ["adamschaefers.com", "enchant.games"]
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
