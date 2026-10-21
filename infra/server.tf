# The server: Ubuntu 24.04 with Docker, in the default VPC. No SSH port is open; shell access and
# deploys both go through AWS Systems Manager (Session Manager / Run Command).

data "aws_vpc" "default" {
  default = true
}

# Canonical's current Ubuntu 24.04 LTS AMI for this region.
data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "aws_security_group" "server" {
  name        = "${var.project}-server"
  description = "HTTP(S) in, everything out"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description      = "HTTP (Lets Encrypt challenges, redirect to HTTPS)"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
  ingress {
    description      = "HTTPS"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
  ingress {
    description      = "HTTP/3"
    from_port        = 443
    to_port          = 443
    protocol         = "udp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
}

resource "aws_instance" "server" {
  ami                     = data.aws_ssm_parameter.ubuntu.value
  instance_type           = var.instance_type
  vpc_security_group_ids  = [aws_security_group.server.id]
  iam_instance_profile    = aws_iam_instance_profile.server.name
  disable_api_termination = true

  user_data = templatefile("${path.module}/cloud-init.sh.tftpl", {
    domain     = var.domain
    acme_email = var.acme_email
    registry   = local.registry
    region     = var.region
    ssm_prefix = local.ssm_prefix
  })

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
    encrypted   = true
  }

  # IMDSv2 only, one hop: the host can use the instance role, containers can't reach it.
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  credit_specification {
    cpu_credits = "standard" # never bill for CPU bursts beyond the instance price
  }

  tags = { Name = "${var.project}-server" }

  lifecycle {
    # A new Ubuntu AMI or a cloud-init edit must not replace a running server.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "server" {
  instance = aws_instance.server.id
  domain   = "vpc"
  tags     = { Name = "${var.project}-server" }
}
