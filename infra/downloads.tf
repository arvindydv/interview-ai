# Desktop installers, served from CloudFront (S3 origin). GitHub's release-asset CDN is often throttled to a
# few KB/s from Indian ISPs, so the website links here instead. Tagged desktop builds upload to
# s3://<bucket>/desktop/v<version>/ (see .github/workflows/desktop.yml).

resource "aws_s3_bucket" "downloads" {
  bucket = "${var.project}-downloads-${local.account_id}"
}

resource "aws_s3_bucket_public_access_block" "downloads" {
  bucket                  = aws_s3_bucket.downloads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "downloads" {
  name                              = "${var.project}-downloads"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS managed "CachingOptimized" policy.
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "downloads" {
  enabled         = true
  comment         = "${var.project} desktop installers"
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = "PriceClass_200" # includes the India edge locations

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.downloads.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.downloads.id
  }

  default_cache_behavior {
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = false # installers are already compressed
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "downloads" {
  bucket = aws_s3_bucket.downloads.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.downloads.arn}/desktop/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.downloads.arn } }
    }]
  })
}

# GitHub Actions role for desktop-v* tag builds only: upload installers, nothing else.
resource "aws_iam_role" "github_desktop" {
  name = "${var.project}-github-desktop"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = [for repo in local.github_subjects : "${repo}:ref:refs/tags/desktop-v*"] }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_desktop" {
  name = "upload-installers"
  role = aws_iam_role.github_desktop.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "UploadInstallers"
      Effect   = "Allow"
      Action   = "s3:PutObject"
      Resource = "${aws_s3_bucket.downloads.arn}/desktop/*"
    }]
  })
}
