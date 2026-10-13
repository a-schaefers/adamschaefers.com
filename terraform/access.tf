# The two Cloudflare Access applications in front of the admin pages (the site's assets admin,
# the license server's). Each names its policy, "Adam only", by id: an app-scoped policy of
# the older kind, which provider 5.24.0 cannot import (its policy resource reads the reusable
# kind only), so the policy's contents are not held here (README.md). The account's Zero
# Trust organization, its identity providers and its WARP app are nobody's.

resource "cloudflare_zero_trust_access_application" "assets_admin" {
  account_id                   = var.account_id
  allow_authenticate_via_warp  = null
  allow_iframe                 = null
  allowed_idps                 = ["97a6c08e-2175-4342-bb64-4e19c885ae9a"]
  app_launcher_logo_url        = null
  app_launcher_visible         = false
  auto_redirect_to_identity    = true
  bg_color                     = null
  cors_headers                 = null
  custom_deny_message          = null
  custom_deny_url              = null
  custom_non_identity_deny_url = null
  custom_pages                 = null
  destinations = [
    {
      cidr          = null
      hostname      = null
      l4_protocol   = null
      mcp_server_id = null
      port_range    = null
      type          = "public"
      uri           = "adamschaefers.com/admin"
      vnet_id       = null
      worker_id     = null
    },
  ]
  domain                     = "adamschaefers.com/admin"
  enable_binding_cookie      = false
  footer_links               = null
  header_bg_color            = null
  http_only_cookie_attribute = true
  landing_page_design        = null
  logo_url                   = null
  mfa_config                 = null
  name                       = "adamschaefers.com assets admin"
  oauth_configuration        = null
  options_preflight_bypass   = false
  path_cookie_attribute      = null
  policies = [
    {
      connection_rules = null
      decision         = null
      exclude          = null
      id               = "b3f02dcf-c542-4869-a4d1-618a63414db0"
      include          = null
      mfa_config       = null
      name             = null
      precedence       = 1
      require          = null
    },
  ]
  read_service_tokens_from_header = null
  saas_app                        = null
  same_site_cookie_attribute      = null
  scim_config                     = null
  service_auth_401_redirect       = null
  session_duration                = "24h"
  skip_interstitial               = null
  tags                            = null
  target_criteria                 = null
  type                            = "self_hosted"
  zone_id                         = null
}

resource "cloudflare_zero_trust_access_application" "licenses_admin" {
  account_id                   = var.account_id
  allow_authenticate_via_warp  = null
  allow_iframe                 = null
  allowed_idps                 = ["97a6c08e-2175-4342-bb64-4e19c885ae9a"]
  app_launcher_logo_url        = null
  app_launcher_visible         = false
  auto_redirect_to_identity    = true
  bg_color                     = null
  cors_headers                 = null
  custom_deny_message          = null
  custom_deny_url              = null
  custom_non_identity_deny_url = null
  custom_pages                 = null
  destinations = [
    {
      cidr          = null
      hostname      = null
      l4_protocol   = null
      mcp_server_id = null
      port_range    = null
      type          = "public"
      uri           = "licenses.adamschaefers.com/admin"
      vnet_id       = null
      worker_id     = null
    },
  ]
  domain                     = "licenses.adamschaefers.com/admin"
  enable_binding_cookie      = false
  footer_links               = null
  header_bg_color            = null
  http_only_cookie_attribute = true
  landing_page_design        = null
  logo_url                   = null
  mfa_config                 = null
  name                       = "Backseat Driver licenses admin"
  oauth_configuration        = null
  options_preflight_bypass   = false
  path_cookie_attribute      = null
  policies = [
    {
      connection_rules = null
      decision         = null
      exclude          = null
      id               = "6a4b1441-5061-4d00-a440-fbf08bbbd887"
      include          = null
      mfa_config       = null
      name             = null
      precedence       = 1
      require          = null
    },
  ]
  read_service_tokens_from_header = null
  saas_app                        = null
  same_site_cookie_attribute      = null
  scim_config                     = null
  service_auth_401_redirect       = null
  session_duration                = "24h"
  skip_interstitial               = null
  tags                            = null
  target_criteria                 = null
  type                            = "self_hosted"
  zone_id                         = null
}
