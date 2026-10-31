#!/usr/bin/env bash
# Deploys one release on this server: refreshes secrets from SSM Parameter Store, pulls the images
# tagged <tag> from ECR, and restarts whatever changed, waiting until every container is healthy.
#
# GitHub Actions runs this through SSM (.github/workflows/deploy.yml). To roll back by hand, run an
# older release's copy with its own tag:
#   sudo /opt/parakeet/releases/<git-sha>/deploy.sh <git-sha>
set -euo pipefail

TAG=${1:?usage: deploy.sh <image-tag>}
PARAKEET_HOME=${PARAKEET_HOME:-/opt/parakeet}
RELEASE=$(cd "$(dirname "$0")" && pwd)

# DOMAIN, ACME_EMAIL, REGISTRY, AWS_REGION, SSM_PREFIX: written once by the server's cloud-init.
set -a
# shellcheck source=/dev/null
. "$PARAKEET_HOME/config.env"
set +a
export TAG PARAKEET_HOME

# SSM <prefix>/<service>/<NAME> parameters → env/<service>.env. Values are single-quoted so Compose
# takes them literally ($, #, spaces); a value with a quote or newline is rejected rather than mangled.
write_env() {
  local service=$1 tmp
  tmp=$(mktemp "$PARAKEET_HOME/env/.$service.XXXXXX")
  aws ssm get-parameters-by-path --region "$AWS_REGION" --path "$SSM_PREFIX/$service/" --with-decryption \
    --query 'Parameters[].[Name,Value]' --output json |
    jq -r --arg q "'" '.[] | (.[0] | split("/") | last) as $k | .[1] as $v
      | if ($v | contains($q) or contains("\n")) then error("\($k): value must not contain single quotes or newlines")
        else "\($k)=\($q)\($v)\($q)" end' >"$tmp"
  if [[ ! -s $tmp ]]; then
    rm -f "$tmp"
    echo "No parameters under $SSM_PREFIX/$service/ (see infra/scripts/push-secrets.sh)" >&2
    exit 1
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$PARAKEET_HOME/env/$service.env"
}

echo "==> Deploying $TAG"
mkdir -p "$PARAKEET_HOME/env"
write_env api
write_env worker
# Auto Apply from Friday's servers (compose profile cloud-apply): their own env files.
if [[ ,${COMPOSE_PROFILES:-}, == *,cloud-apply,* ]]; then
  write_env applier
  write_env browser
  # The browser container's AppArmor profile (docker-default plus user namespaces for Chrome's sandbox).
  apparmor_parser -r -W "$RELEASE/apparmor/parakeet-chromium"
fi

cd "$RELEASE"
docker compose pull --quiet
docker compose up -d --remove-orphans --wait --wait-timeout 180
ln -sfn "$RELEASE" "$PARAKEET_HOME/current"

# Keep a week of images for quick rollbacks, and the last 10 release bundles.
docker image prune -af --filter "until=168h" >/dev/null
# shellcheck disable=SC2012 # release dirs are git SHAs
ls -1dt "$PARAKEET_HOME"/releases/*/ | tail -n +11 | xargs -r rm -rf

docker compose ps --format 'table {{.Service}}\t{{.Status}}'
echo "==> $TAG is live"
