variable "account_id" {
  description = "Cloudflare account. Shared with the other sites' zones — see README.md on blast radius."
  type        = string
  default     = "6093bc0889c95a08f0a92a8df6750c66"
}

variable "zone_id" {
  description = "The adamschaefers.com zone."
  type        = string
  default     = "8c24a36f8948b4e42d61ae9f69e6c434"
}

variable "github_owner" {
  description = "GitHub account owning the site's repositories (a user, not an organization)."
  type        = string
  default     = "a-schaefers"
}
