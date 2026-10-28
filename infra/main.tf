# AWS for Parakeet's server apps (web, admin, jobs, api, worker + Redis) on one EC2 instance running Docker
# Compose behind Caddy. Postgres and Auth stay on Supabase. See docs/DEPLOYMENT.md.
#
#   cd infra && cp terraform.tfvars.example terraform.tfvars   # fill it in
#   terraform init && terraform apply
#
# Creates: ECR repositories, an S3 bucket for release bundles, the server (Elastic IP, security group,
# IAM role, cloud-init), and a GitHub OIDC role so Actions can deploy without stored AWS keys.
# Secrets are NOT managed here (they'd end up in Terraform state); see scripts/push-secrets.sh.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
  # State is local (terraform.tfstate, git-ignored) to start. Move it to S3 once more than one person
  # runs Terraform: https://developer.hashicorp.com/terraform/language/backend/s3
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = var.project, ManagedBy = "terraform" }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  registry   = "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com"
  ssm_prefix = "/${var.project}/prod"
  apps       = ["api", "worker", "web", "admin", "jobs"]
}
