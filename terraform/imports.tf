# Adoption of existing infrastructure (2026-10-12), as in ../merecatholicity.com. Every id
# below was read from the live Cloudflare and GitHub APIs that day; none is guessed.
#
# The loop:
#   terraform plan -generate-config-out=generated.tf
#   (fold generated.tf into the topic files, then delete it)
#   terraform plan          # iterate until it shows only the imports
#   terraform apply         # writes state only; changes nothing live
#
# NOTHING here may be applied while the plan shows a destroy or a replace. A replaced
# cloudflare_d1_database destroys the license server's records; a replaced r2_bucket
# destroys the media or the state. Stateful resources carry prevent_destroy in their own
# files as a second line of defence.

############################  zone  ############################

import {
  to = cloudflare_zone.main
  id = "8c24a36f8948b4e42d61ae9f69e6c434"
}

import {
  to = cloudflare_zone_setting.ssl
  id = "8c24a36f8948b4e42d61ae9f69e6c434/ssl"
}

import {
  to = cloudflare_zone_setting.always_use_https
  id = "8c24a36f8948b4e42d61ae9f69e6c434/always_use_https"
}

import {
  to = cloudflare_zone_setting.browser_cache_ttl
  id = "8c24a36f8948b4e42d61ae9f69e6c434/browser_cache_ttl"
}

import {
  to = cloudflare_bot_management.main
  id = "8c24a36f8948b4e42d61ae9f69e6c434"
}

import {
  to = cloudflare_tiered_cache.main
  id = "8c24a36f8948b4e42d61ae9f69e6c434"
}

import {
  to = cloudflare_argo_tiered_caching.main
  id = "8c24a36f8948b4e42d61ae9f69e6c434"
}

############################  dns  #############################

import {
  to = cloudflare_dns_record.apex
  id = "8c24a36f8948b4e42d61ae9f69e6c434/abd9a4ad63a860becdf365bf0b980b85"
}

import {
  to = cloudflare_dns_record.media
  id = "8c24a36f8948b4e42d61ae9f69e6c434/62683f0c18a6e3535460baa5f64b7028"
}

import {
  to = cloudflare_dns_record.resend_rsend
  id = "8c24a36f8948b4e42d61ae9f69e6c434/b1d34510492c464e6c221dcdab05b246"
}

import {
  to = cloudflare_dns_record.resend_send
  id = "8c24a36f8948b4e42d61ae9f69e6c434/c4ed00f1048d2b4631d9de7edf82b569"
}

import {
  to = cloudflare_dns_record.mx_route3
  id = "8c24a36f8948b4e42d61ae9f69e6c434/ed30432ea97b5acc530cf5c61abbab5a"
}

import {
  to = cloudflare_dns_record.mx_route2
  id = "8c24a36f8948b4e42d61ae9f69e6c434/c2c659bd4283f128ded16e259105597f"
}

import {
  to = cloudflare_dns_record.mx_route1
  id = "8c24a36f8948b4e42d61ae9f69e6c434/437711db489758d6ea94b68c31da2a91"
}

import {
  to = cloudflare_dns_record.spf
  id = "8c24a36f8948b4e42d61ae9f69e6c434/526e1ce66fe2ad1abb21e349c6490dad"
}

import {
  to = cloudflare_dns_record.google_site_verification_1
  id = "8c24a36f8948b4e42d61ae9f69e6c434/5023248258e6b3a1f33da5fef430bfe3"
}

import {
  to = cloudflare_dns_record.google_site_verification_2
  id = "8c24a36f8948b4e42d61ae9f69e6c434/287957a6247428516880e1726ca823c5"
}

import {
  to = cloudflare_dns_record.dkim_cf2024
  id = "8c24a36f8948b4e42d61ae9f69e6c434/4b73495330e86a272868b9c884da1f26"
}

import {
  to = cloudflare_dns_record.dmarc
  id = "8c24a36f8948b4e42d61ae9f69e6c434/dfba457700a6369e63f538c3d785bb69"
}

import {
  to = cloudflare_dns_record.dkim_wildcard
  id = "8c24a36f8948b4e42d61ae9f69e6c434/09637e915937a646f05f734552d31c84"
}

import {
  to = cloudflare_dns_record.dkim_resend
  id = "8c24a36f8948b4e42d61ae9f69e6c434/d532a351a7d7ce5bf206b7123ada8ccb"
}

import {
  to = cloudflare_dns_record.contact_api
  id = "8c24a36f8948b4e42d61ae9f69e6c434/af2eba4229ee9bdd4710075147dd0f71"
}

import {
  to = cloudflare_dns_record.licenses
  id = "8c24a36f8948b4e42d61ae9f69e6c434/8eb2298d1db023596320de28b7128bf3"
}

##########################  rulesets  ##########################

import {
  to = cloudflare_ruleset.rate_limit
  id = "zones/8c24a36f8948b4e42d61ae9f69e6c434/f7dbadbdb0614feb9bd40b851bf98575"
}

#####################  account-scoped objects  #####################

import {
  to = cloudflare_turnstile_widget.contact
  id = "6093bc0889c95a08f0a92a8df6750c66/0x4AAAAAAFSCqQ6GlpqWfqoi"
}

import {
  to = cloudflare_turnstile_widget.store
  id = "6093bc0889c95a08f0a92a8df6750c66/0x4AAAAAAFTf5pqbx6A0pJGb"
}

import {
  to = cloudflare_d1_database.licenses
  id = "6093bc0889c95a08f0a92a8df6750c66/82cd50be-9537-4e53-8779-452a42299433"
}

import {
  to = cloudflare_r2_bucket.media
  id = "6093bc0889c95a08f0a92a8df6750c66/adamschaefers-media/default"
}

import {
  to = cloudflare_r2_bucket.tfstate
  id = "6093bc0889c95a08f0a92a8df6750c66/adamschaefers-tfstate/default"
}

import {
  to = cloudflare_zero_trust_access_application.assets_admin
  id = "accounts/6093bc0889c95a08f0a92a8df6750c66/52bd5df8-ff86-40a6-b114-0a8ff1bf00cf"
}

import {
  to = cloudflare_zero_trust_access_application.licenses_admin
  id = "accounts/6093bc0889c95a08f0a92a8df6750c66/c8a874f2-d654-4628-8caf-204a53183b8e"
}

###########################  github  ###########################

import {
  to = github_repository.site
  id = "adamschaefers.com"
}

import {
  to = github_repository_ruleset.master
  id = "adamschaefers.com:24870666"
}

import {
  to = github_repository_environment.production
  id = "adamschaefers.com:production"
}

import {
  to = github_repository_environment_deployment_policy.production_master
  id = "adamschaefers.com:production:62657204"
}

import {
  to = github_repository_environment.terraform_production
  id = "adamschaefers.com:terraform-production"
}

import {
  to = github_repository_environment_deployment_policy.terraform_production_master
  id = "adamschaefers.com:terraform-production:62861470"
}

import {
  to = github_workflow_repository_permissions.site
  id = "adamschaefers.com"
}

import {
  to = github_actions_repository_permissions.site
  id = "adamschaefers.com"
}

import {
  to = github_repository_vulnerability_alerts.site
  id = "adamschaefers.com"
}

import {
  to = github_repository_dependabot_security_updates.site
  id = "adamschaefers.com"
}

import {
  to = github_actions_variable.cloudflare_account_id
  id = "adamschaefers.com:CLOUDFLARE_ACCOUNT_ID"
}

import {
  to = github_actions_variable.cloudflare_zone_id
  id = "adamschaefers.com:CLOUDFLARE_ZONE_ID"
}
