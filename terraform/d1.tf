# The license server's database, as a record that it exists. Its tables are the Worker's
# migrations (license-worker/, wrangler); its rows the store's.

resource "cloudflare_d1_database" "licenses" {
  account_id            = var.account_id
  jurisdiction          = null
  name                  = "adamschaefers-licenses"
  primary_location_hint = null
  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}
