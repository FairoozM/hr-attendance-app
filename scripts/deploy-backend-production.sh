#!/usr/bin/env bash
# Deploy backend to EC2 (eu-central-1) via S3 artifact + SSM.
# Requires: AWS CLI, IAM with s3:PutObject, ssm:SendCommand on the instance.
# Set AWS_PROFILE if needed, e.g. AWS_PROFILE=abdullah-deploy
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-eu-central-1}"
INSTANCE_ID="${HR_BACKEND_INSTANCE_ID:-i-00f9451138c169214}"
BUCKET="${HR_BACKEND_ARTIFACT_BUCKET:-hr-lifesmile-artifacts}"
KEY="hr-backend-latest.tar.gz"
ARTIFACT="/tmp/${KEY}"
TMPJSON="$(mktemp)"
REMOTE_SCRIPT="$(mktemp)"

cleanup_local() {
  rm -f "$TMPJSON" "$REMOTE_SCRIPT"
}
trap cleanup_local EXIT

ssm_disk_snapshot() {
  local label="$1"
  local cmd_id
  local snapshot_json
  snapshot_json="$(mktemp)"
  echo "==> ${label}"
  cat >"$snapshot_json" <<EOF
{
  "commands": [
    "echo '=== Disk usage (${label}) ==='",
    "df -h /",
    "if [ -f ${ARTIFACT} ]; then ls -lah ${ARTIFACT}; else echo '${ARTIFACT} not present'; fi"
  ]
}
EOF
  cmd_id=$(aws ssm send-command --region "$REGION" \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters "file://${snapshot_json}" \
    --query 'Command.CommandId' --output text)
  rm -f "$snapshot_json"
  sleep 5
  aws ssm get-command-invocation --region "$REGION" --command-id "$cmd_id" --instance-id "$INSTANCE_ID" \
    --query 'StandardOutputContent' --output text || true
}

cat >"$REMOTE_SCRIPT" <<REMOTE
set -eu

echo "=== Disk usage before deploy ==="
df -h /

cd /home/ubuntu/hr-attendance-app
sudo -u ubuntu aws s3 cp s3://${BUCKET}/${KEY} ${ARTIFACT}
sudo -u ubuntu tar xzf ${ARTIFACT} -C /home/ubuntu/hr-attendance-app
cd /home/ubuntu/hr-attendance-app/backend
sudo -u ubuntu npm ci --omit=dev
systemctl restart hr-attendance-backend.service
bash -c 'set -e; for i in \$(seq 1 45); do if curl -sf -m 3 http://127.0.0.1:5001/api/health; then echo health_ok; exit 0; fi; sleep 1; done; echo health check timed out after 45s >&2; exit 1'

echo "=== Disk usage after deploy (before /tmp cleanup) ==="
df -h /
ls -lah ${ARTIFACT}

rm -f ${ARTIFACT}
if [ -e ${ARTIFACT} ]; then
  echo "ERROR: failed to remove ${ARTIFACT}" >&2
  exit 1
fi
echo "Removed ${ARTIFACT} after successful health check"

echo "=== Disk usage after /tmp cleanup ==="
df -h /
REMOTE

python3 - "$REMOTE_SCRIPT" "$TMPJSON" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    script = f.read()

with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump({"commands": [script]}, f)
PY

echo "==> Packaging backend..."
tar czf "/tmp/$KEY" --exclude=node_modules --exclude=.env --exclude=backend/data -C "$ROOT" backend shared

echo "==> Uploading s3://${BUCKET}/${KEY}..."
aws s3 cp "/tmp/$KEY" "s3://${BUCKET}/${KEY}" --region "$REGION"

echo "==> SSM deploy on ${INSTANCE_ID}..."
CMD_ID=$(aws ssm send-command --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "file://${TMPJSON}" \
  --query 'Command.CommandId' --output text)

# npm ci + extract + health poll can take 60s+
sleep 60
STATUS=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query 'Status' --output text)
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query '[StandardOutputContent,StandardErrorContent]' --output text

if [ "$STATUS" != "Success" ]; then
  echo "==> Deploy failed (SSM status: ${STATUS}). Fetching disk usage for debugging..."
  ssm_disk_snapshot "deploy failure snapshot"
  exit 1
fi

echo "Done."
