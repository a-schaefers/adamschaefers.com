# Every record in the zone. The apex: a proxied placeholder (AAAA 100::), so the Worker route
# adamschaefers.com/* (adamschaefers-site) answers every request. The custom domains, each a
# record Cloudflare made and marks read only: media (the adamschaefers-media bucket's R2
# custom domain, whose binding the provider cannot import), contact-api and licenses (the
# contact and license Workers' custom domains, which wrangler made). Declared, as
# ../merecatholicity.com declares its own, so a record changed or removed by hand shows in
# the plan. Email: Email Routing's three MX, SPF, DKIM (cf2024-1, read only) and DMARC, the
# empty wildcard DKIM, and Resend's sending records. And Google's two site verifications.

resource "cloudflare_dns_record" "apex" {
  comment         = "placeholder: the Worker route adamschaefers.com/* (adamschaefers-site) answers every request"
  content         = "100::"
  data            = null
  name            = "adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = true
  settings = {
  }
  tags    = []
  ttl     = 1
  type    = "AAAA"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "media" {
  comment         = null
  content         = "public.r2.dev"
  data            = null
  name            = "media.adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = true
  settings = {
    flatten_cname = false
    ipv4_only     = false
    ipv6_only     = false
  }
  tags    = []
  ttl     = 1
  type    = "CNAME"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "contact_api" {
  comment         = null
  content         = "100::"
  data            = null
  name            = "contact-api.adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = true
  settings = {
  }
  tags    = []
  ttl     = 1
  type    = "AAAA"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "licenses" {
  comment         = null
  content         = "100::"
  data            = null
  name            = "licenses.adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = true
  settings = {
  }
  tags    = []
  ttl     = 1
  type    = "AAAA"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "mx_route1" {
  comment         = null
  content         = "route1.mx.cloudflare.net"
  data            = null
  name            = "adamschaefers.com"
  priority        = 46
  private_routing = null
  proxied         = false
  settings = {
  }
  tags    = []
  ttl     = 1
  type    = "MX"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "mx_route2" {
  comment         = null
  content         = "route2.mx.cloudflare.net"
  data            = null
  name            = "adamschaefers.com"
  priority        = 7
  private_routing = null
  proxied         = false
  settings = {
  }
  tags    = []
  ttl     = 1
  type    = "MX"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "mx_route3" {
  comment         = null
  content         = "route3.mx.cloudflare.net"
  data            = null
  name            = "adamschaefers.com"
  priority        = 77
  private_routing = null
  proxied         = false
  settings = {
  }
  tags    = []
  ttl     = 1
  type    = "MX"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "spf" {
  comment         = null
  content         = "\"v=spf1 include:_spf.mx.cloudflare.net ~all\""
  data            = null
  name            = "adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
  }
  tags    = []
  ttl     = 1
  type    = "TXT"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "dkim_cf2024" {
  comment         = null
  content         = "\"v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78k\" \"m4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB\""
  data            = null
  name            = "cf2024-1._domainkey.adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
  }
  tags    = []
  ttl     = 1
  type    = "TXT"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "dmarc" {
  comment         = null
  content         = "\"v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;\""
  data            = null
  name            = "_dmarc.adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
  }
  tags    = []
  ttl     = 1
  type    = "TXT"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "dkim_wildcard" {
  comment         = null
  content         = "\"v=DKIM1; p=\""
  data            = null
  name            = "*._domainkey.adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
  }
  tags    = []
  ttl     = 1
  type    = "TXT"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "resend_send" {
  comment         = null
  content         = "send.forge.rmta.net"
  data            = null
  name            = "send.adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
    flatten_cname = false
    ipv4_only     = false
    ipv6_only     = false
  }
  tags    = []
  ttl     = 3600
  type    = "CNAME"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "resend_rsend" {
  comment         = null
  content         = "rsend.forge.rmta.net"
  data            = null
  name            = "rsend.adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
    flatten_cname = false
    ipv4_only     = false
    ipv6_only     = false
  }
  tags    = []
  ttl     = 3600
  type    = "CNAME"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "dkim_resend" {
  comment         = null
  content         = "\"p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDUlfFA42j5g79QXXC0z3SvOBzae+hkEectdXZHj2NqHgGzNKOOqBLr4SDlk656+zs+xI0s1iq/O2Rwol8bbM3rdc1Rt7jWHzSNk21TLd8IO0Rda3lR3WtHO8KNDZHLFUMM2fqbQvXJa07Y+ONJbzC8LAQfPREYY0Xk/kAmtGqeYwIDAQAB\""
  data            = null
  name            = "resend._domainkey.adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
  }
  tags    = []
  ttl     = 3600
  type    = "TXT"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "google_site_verification_1" {
  comment         = null
  content         = "\"google-site-verification=g0UzeVtkRVVnfeb3TiXPN9BWyoU9HcPfqSsnHG23DTI\""
  data            = null
  name            = "adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
  }
  tags    = []
  ttl     = 3600
  type    = "TXT"
  zone_id = var.zone_id
}

resource "cloudflare_dns_record" "google_site_verification_2" {
  comment         = null
  content         = "\"google-site-verification=q-U9CC0KO0c9VIylwTusUJk6a8xhdWVuSI5B7U2_vRw\""
  data            = null
  name            = "adamschaefers.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
  }
  tags    = []
  ttl     = 3600
  type    = "TXT"
  zone_id = var.zone_id
}
