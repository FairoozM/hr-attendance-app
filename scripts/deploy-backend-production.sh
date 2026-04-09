#!/usr/bin/env bash
# Deploy backend to EC2 (eu-central-1) via S3 artifact + SSM.
# Requires: AWS CLI, IAM with s3:PutObject, ssm:SendCommand on the instance.
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
    "sleep 2",
    "curl -sS http://127.0.0.1:5001/api/health"
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

sleep 22
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text

echo "Done."
