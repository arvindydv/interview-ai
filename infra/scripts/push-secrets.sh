#!/usr/bin/env bash
# Uploads a service's env file to SSM Parameter Store, one encrypted (SecureString) parameter per
# variable. The server rebuilds its env file from these on every deploy (deploy/deploy.sh), so after
# changing a secret, re-run this and then redeploy.
#
#   infra/scripts/push-secrets.sh api    ~/parakeet-secrets/api.env
#   infra/scripts/push-secrets.sh worker ~/parakeet-secrets/worker.env
#
# Keep those env files outside the repo. Empty values are skipped. To remove a variable:
#   aws ssm delete-parameter --name /parakeet/prod/<service>/<NAME>
# Needs AWS CLI v2. Env: AWS_REGION (default: your CLI's region), SSM_PREFIX (default /parakeet/prod).
set -euo pipefail

service=${1:?usage: push-secrets.sh <api|worker> <env-file>}
file=${2:?usage: push-secrets.sh <api|worker> <env-file>}
prefix=${SSM_PREFIX:-/parakeet/prod}
region=${AWS_REGION:-$(aws configure get region)}

[[ $service == api || $service == worker ]] || { echo "service must be api or worker" >&2; exit 1; }

count=0
while IFS= read -r line || [[ -n $line ]]; do
  [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
  name=${line%%=*}
  value=${line#*=}
  name=${name//[[:space:]]/}
  # Strip one pair of surrounding quotes, as dotenv does.
  if [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]]; then value=${BASH_REMATCH[1]}; fi
  if [[ -z $value ]]; then
    echo "skip  $name (empty)"
    continue
  fi
  aws ssm put-parameter --region "$region" --name "$prefix/$service/$name" \
    --type SecureString --value "$value" --overwrite >/dev/null </dev/null # don't let it eat the loop's stdin
  echo "set   $prefix/$service/$name"
  count=$((count + 1))
done <"$file"

echo "$count parameters written for $service. Redeploy for them to take effect."
