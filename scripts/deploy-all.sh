#!/usr/bin/env bash
# Full stack: frontend (S3 + CloudFront) + backend (S3 + SSM).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Ensures dist/api-runtime-config.js pins the Express origin (see scripts/inject-api-runtime-config.js).
export HR_REQUIRE_PUBLIC_API_URL=1
npm run deploy:frontend
bash scripts/deploy-backend-production.sh
