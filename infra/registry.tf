# Container images, one repository per app, tagged with the git commit SHA.
resource "aws_ecr_repository" "app" {
  for_each             = toset(local.apps)
  name                 = "${var.project}-${each.key}"
  image_tag_mutability = "MUTABLE" # re-running a deploy for the same commit re-pushes the same tag
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Storage is the only ECR cost; keep the 15 newest images per app (plenty for rollbacks).
resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 15 newest images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 15 }
      action       = { type = "expire" }
    }]
  })
}

# Release bundles (deploy/compose.yml, Caddyfile, deploy.sh) per commit, fetched by the server.
resource "aws_s3_bucket" "releases" {
  bucket        = "${var.project}-releases-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "releases" {
  bucket                  = aws_s3_bucket.releases.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "releases" {
  bucket = aws_s3_bucket.releases.id
  rule {
    id     = "expire-old-releases"
    status = "Enabled"
    filter { prefix = "releases/" }
    expiration { days = 90 }
  }
}
