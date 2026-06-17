#!/usr/bin/env bash
# List logical DB backups uploaded by scripts/backup-postgres-to-s3.sh
#
#   export HR_DB_BACKUP_BUCKET=your-bucket
#   Optional: HR_DB_BACKUP_PREFIX=hr-attendance-db  AWS_REGION=eu-central-1
#   bash scripts/list-db-backups-s3.sh
#
set -euo pipefail
REGION="${AWS_REGION:-eu-central-1}"
BUCKET="${HR_DB_BACKUP_BUCKET:?Set HR_DB_BACKUP_BUCKET}"
PREFIX="${HR_DB_BACKUP_PREFIX:-hr-attendance-db}"
aws s3 ls "s3://${BUCKET}/${PREFIX}/" --region "$REGION" | sort
