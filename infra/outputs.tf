output "server_ip" {
  description = "Point A records for DOMAIN, www, api, admin and jobs here."
  value       = aws_eip.server.public_ip
}

output "server_instance_id" {
  value = aws_instance.server.id
}

output "registry" {
  value = local.registry
}

output "dns_records" {
  description = "Create these at your DNS provider before the first deploy."
  value = {
    for host in [var.domain, "www.${var.domain}", "api.${var.domain}", "admin.${var.domain}", "jobs.${var.domain}"] :
    host => "A ${aws_eip.server.public_ip}"
  }
}

output "github_variables" {
  description = "Run these once (GitHub CLI), or add them under repo Settings → Secrets and variables → Actions → Variables."
  value       = <<-EOT
    gh variable set AWS_REGION          --body '${var.region}'
    gh variable set AWS_DEPLOY_ROLE_ARN --body '${aws_iam_role.github_deploy.arn}'
    gh variable set DEPLOY_BUCKET       --body '${aws_s3_bucket.releases.bucket}'
    gh variable set SERVER_INSTANCE_ID  --body '${aws_instance.server.id}'
    gh variable set WEB_URL             --body 'https://${var.domain}'
    gh variable set NEXT_PUBLIC_API_URL --body 'https://api.${var.domain}'
    gh variable set JOBS_URL            --body 'https://jobs.${var.domain}'
    gh variable set DESKTOP_UPLOAD_ROLE_ARN --body '${aws_iam_role.github_desktop.arn}'
    gh variable set DOWNLOADS_BUCKET        --body '${aws_s3_bucket.downloads.bucket}'
    gh variable set DOWNLOADS_HOST          --body 'https://${aws_cloudfront_distribution.downloads.domain_name}'
  EOT
}

output "shell" {
  description = "Open a root shell on the server (needs the Session Manager plugin for the AWS CLI)."
  value       = "aws ssm start-session --region ${var.region} --target ${aws_instance.server.id}"
}
