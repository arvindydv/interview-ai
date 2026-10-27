variable "region" {
  description = "AWS region. Pick the one closest to your users and to your Supabase project's region."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Name prefix for every resource."
  type        = string
  default     = "parakeet"
}

variable "domain" {
  description = "Apex domain, e.g. example.com. The site is served at DOMAIN, api.DOMAIN and admin.DOMAIN."
  type        = string
}

variable "acme_email" {
  description = "Email for Let's Encrypt certificate expiry notices."
  type        = string
}

variable "github_repo" {
  description = "owner/name of the GitHub repository allowed to deploy."
  type        = string
  default     = "arvindydv/interview-ai"
}

variable "github_repo_with_ids" {
  description = "The same repository in GitHub's immutable-ID OIDC subject form, owner@<owner id>/name@<repo id>."
  type        = string
  default     = "arvindydv@132453023/interview-ai@1421918956"
}

variable "create_github_oidc_provider" {
  description = "Set false if this AWS account already has the token.actions.githubusercontent.com OIDC provider."
  type        = bool
  default     = true
}

variable "instance_type" {
  description = "t3.small (2 GB) leaves room to grow; the stack idles at ~250 MB, so t3.micro (1 GB) also works."
  type        = string
  default     = "t3.small"
}

variable "root_volume_gb" {
  description = "Root disk size (images, Redis data, logs)."
  type        = number
  default     = 30
}
