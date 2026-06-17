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
TMPJSON="$(mktemp)"

echo "==> Packaging backend..."
tar czf "/tmp/$KEY" --exclude=node_modules --exclude=.env -C "$ROOT" backend

echo "==> Uploading s3://${BUCKET}/${KEY}..."
aws s3 cp "/tmp/$KEY" "s3://${BUCKET}/${KEY}" --region "$REGION"

cat >"$TMPJSON" <<EOF
{
  "commands": [
    "set -e",
    "cd /home/ubuntu/hr-attendance-app",
    "sudo -u ubuntu aws s3 cp s3://${BUCKET}/${KEY} /tmp/${KEY}",
    "sudo -u ubuntu tar xzf /tmp/${KEY} -C /home/ubuntu/hr-attendance-app",
    "cd /home/ubuntu/hr-attendance-app/backend",
    "sudo -u ubuntu npm ci --omit=dev",
    "systemctl restart hr-attendance-backend.service",
    "bash -c 'set -e; for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45; do if curl -sf -m 3 http://127.0.0.1:5001/api/health; then echo health_ok; exit 0; fi; sleep 1; done; echo health check timed out after 45s >&2; exit 1'"
  ]
}
EOF

echo "==> SSM deploy on ${INSTANCE_ID}..."
CMD_ID=$(aws ssm send-command --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "file://${TMPJSON}" \
  --query 'Command.CommandId' --output text)
rm -f "$TMPJSON"

# npm ci + extract + health poll can take 60s+
sleep 60
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text

echo "Done."
