#!/usr/bin/env bash
# Logical backup: pg_dump (custom format) → gzip → S3.
#
# On EC2 (cron / manual):
#   export HR_DB_BACKUP_BUCKET=your-backups-bucket
#   export AWS_REGION=eu-central-1   # optional
#   Optional: HR_DB_BACKUP_PREFIX=hr-attendance-db  (S3 key prefix)
#   Optional: HR_BACKEND_ENV_FILE=/path/to/backend/.env  (if DATABASE_URL unset)
#
# IAM: instance profile needs s3:PutObject on s3://$HR_DB_BACKUP_BUCKET/$PREFIX/*
#
# Retention: add an S3 lifecycle rule to expire old objects (e.g. keep 30 days).
#
# Restore (example — use a throwaway DB first to verify):
#   aws s3 cp s3://bucket/prefix/hr_attendance_YYYYMMDDTHHMMSSZ.dump.gz - | gunzip -c | pg_restore -d "$DATABASE_URL" --no-owner --no-acl --clean --if-exists
#
set -euo pipefail

REGION="${AWS_REGION:-eu-central-1}"
BUCKET="${HR_DB_BACKUP_BUCKET:?Set HR_DB_BACKUP_BUCKET (S3 bucket name)}"
PREFIX="${HR_DB_BACKUP_PREFIX:-hr-attendance-db}"
ENV_FILE="${HR_BACKEND_ENV_FILE:-/home/ubuntu/hr-attendance-app/backend/.env}"

if [[ -z "${DATABASE_URL:-}" && -f "$ENV_FILE" ]]; then
  line="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" || true)"
  if [[ -n "$line" ]]; then
    v="${line#DATABASE_URL=}"
    v="${v%\"}"
    v="${v#\"}"
    v="${v%\'}"
    v="${v#\'}"
    export DATABASE_URL="$v"
  fi
fi

: "${DATABASE_URL:?DATABASE_URL not set (export it or use $ENV_FILE)}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="/tmp/hr_attendance_${STAMP}.dump.gz"
KEY="${PREFIX}/hr_attendance_${STAMP}.dump.gz"
REMOTE="s3://${BUCKET}/${KEY}"

pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" | gzip -1 >"$TMP"
aws s3 cp "$TMP" "$REMOTE" --region "$REGION" --sse AES256
rm -f "$TMP"

echo "Backup uploaded: $REMOTE"
