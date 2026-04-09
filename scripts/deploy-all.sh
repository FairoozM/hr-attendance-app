#!/usr/bin/env bash
# Full stack: frontend (S3 + CloudFront) + backend (S3 + SSM).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm run deploy:frontend
bash scripts/deploy-backend-production.sh
