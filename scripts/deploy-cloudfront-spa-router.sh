#!/usr/bin/env bash
#
# Creates or updates the hr-spa-router CloudFront Function and attaches it to the default
# (S3) behaviour at viewer-request, so that browser deep links such as /ai/amazon-initial-draft
# are served the SPA shell instead of S3's 403.
#
#   AWS_PROFILE=abdullah-deploy bash scripts/deploy-cloudfront-spa-router.sh
#
# Rehearse without changing anything:
#
#   DRY_RUN=1 AWS_PROFILE=abdullah-deploy bash scripts/deploy-cloudfront-spa-router.sh
#
# It is idempotent: with the function published and already associated it reports "no change"
# and exits without touching the distribution. It is deliberately NOT part of deploy:all —
# edge configuration changes on their own schedule, and a routine application deploy should not
# be able to reshape the distribution.
#
# What it will NOT do: add, remove or reorder origins or cache behaviours, alter cache or
# origin-request policies, touch /api/* routing, change the WAF association, add
# distribution-wide custom error responses (see docs/cloudfront-production-configuration.md
# for why those must never be used here), or delete any function. If the distribution does not
# look the way it is expected to, it stops instead of guessing.
#
# Nothing in this file is a secret, so it is safe to commit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FUNCTION_NAME="${FUNCTION_NAME:-hr-spa-router}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-E2YFDZQHMQS2BG}"
SOURCE_FILE="${SOURCE_FILE:-scripts/cloudfront/spa-router.js}"
TEST_FILE="${TEST_FILE:-scripts/cloudfront/spa-router.test.js}"
RUNTIME="${RUNTIME:-cloudfront-js-2.0}"
COMMENT="${COMMENT:-Rewrite SPA client-side routes to /index.html; leaves /api/* alone}"
DRY_RUN="${DRY_RUN:-0}"

# A viewer-request function that is neither ours nor a name listed here means somebody
# configured something this script does not know about. Replacing it blindly could silently
# drop their rewrite, so the run stops unless the name is expected.
REPLACEABLE_FUNCTIONS="${REPLACEABLE_FUNCTIONS:-hr-rto-agent-spa-rewrite}"

for tool in aws python3 node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 1; }
done
[ -f "$SOURCE_FILE" ] || { echo "missing function source: $SOURCE_FILE" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------- the function must be sound
# Shipping a rewrite that sends /api to the SPA shell would mask API errors as HTML 200s, so
# the suite runs before anything reaches AWS, in the spirit of deploy-all.sh's baseline check.
echo "==> Testing the function"
node --test "$TEST_FILE" >"$WORK/test.log" 2>&1 || {
  echo "the function's tests fail; refusing to deploy it" >&2
  cat "$WORK/test.log" >&2
  exit 1
}
echo "    $(grep -c '^ok ' "$WORK/test.log" || true) assertions passed"

# ---------------------------------------------------------------- inspect the distribution
echo "==> Inspecting distribution ${DISTRIBUTION_ID}"
aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" >"$WORK/dist.json"

# Refuses on anything unexpected. The point is that a mis-detected distribution must abort
# rather than be reshaped: everything here is a precondition, not a repair.
python3 - "$WORK/dist.json" "$FUNCTION_NAME" "$REPLACEABLE_FUNCTIONS" >"$WORK/facts.env" <<'PY'
import json, sys

path, function_name, replaceable = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
doc = json.load(open(path))
cfg = doc['DistributionConfig']

origins = {o['Id']: o for o in cfg['Origins']['Items']}


def is_s3(origin_id):
    domain = origins[origin_id]['DomainName']
    return '.s3.' in domain or '.s3-website' in domain or domain.endswith('.s3.amazonaws.com')


def fail(message):
    sys.stderr.write('unexpected distribution structure: %s\n' % message)
    sys.exit(1)


default = cfg['DefaultCacheBehavior']
if not is_s3(default['TargetOriginId']):
    fail('the default behaviour targets %r, which is not an S3 origin. This function must only '
         'ever run in front of the static site.' % default['TargetOriginId'])

behaviours = {b['PathPattern']: b for b in cfg.get('CacheBehaviors', {}).get('Items', [])}
for pattern in ('/api', '/api/*'):
    if pattern not in behaviours:
        fail('no %r cache behaviour. The API would fall through to S3 and this function would '
             'then rewrite it to the SPA shell.' % pattern)
    if is_s3(behaviours[pattern]['TargetOriginId']):
        fail('the %r behaviour points at an S3 origin' % pattern)

associations = default.get('FunctionAssociations', {})
items = associations.get('Items', []) if associations.get('Quantity', 0) else []
viewer = [i for i in items if i['EventType'] == 'viewer-request']
if len(viewer) > 1:
    fail('more than one viewer-request function is associated')

current = viewer[0]['FunctionARN'].rsplit('/', 1)[-1] if viewer else ''
if current and current != function_name and current not in replaceable:
    fail('%r is already attached at viewer-request and is not a name this script expects to '
         'replace. Check what it does, then add it to REPLACEABLE_FUNCTIONS if replacing it is '
         'genuinely intended.' % current)

print('ETAG=%s' % doc['ETag'])
print('CURRENT_FUNCTION=%s' % current)
print("S3_ORIGIN='%s'" % default['TargetOriginId'])
print('API_PATTERNS=%d' % len(behaviours))
PY

# shellcheck source=/dev/null
. "$WORK/facts.env"
echo "    default behaviour -> ${S3_ORIGIN}"
echo "    ${API_PATTERNS} non-default behaviours preserved, including /api and /api/*"
echo "    viewer-request today: ${CURRENT_FUNCTION:-(none)}"

# ---------------------------------------------------------------- create or update the function
echo "==> Reconciling function ${FUNCTION_NAME}"

FUNCTION_EXISTS=0
FUNCTION_ETAG=""
if FUNCTION_ETAG="$(aws cloudfront describe-function --name "$FUNCTION_NAME" --stage DEVELOPMENT \
  --query 'ETag' --output text 2>/dev/null)"; then
  FUNCTION_EXISTS=1
fi

CODE_CHANGED=1
if [ "$FUNCTION_EXISTS" -eq 1 ]; then
  # Compare against LIVE, because LIVE is what serves traffic. An unpublished DEVELOPMENT
  # version that happens to match is not the same as the edge running this code.
  if aws cloudfront get-function --name "$FUNCTION_NAME" --stage LIVE "$WORK/live.js" >/dev/null 2>&1 \
    && cmp -s "$SOURCE_FILE" "$WORK/live.js"; then
    CODE_CHANGED=0
  fi
fi

if [ "$CODE_CHANGED" -eq 0 ]; then
  echo "    LIVE already matches ${SOURCE_FILE}; no publish needed"
elif [ "$DRY_RUN" = "1" ]; then
  if [ "$FUNCTION_EXISTS" -eq 1 ]; then
    echo "    would update and publish (LIVE differs from ${SOURCE_FILE})"
  else
    echo "    would create and publish ${FUNCTION_NAME}"
  fi
else
  if [ "$FUNCTION_EXISTS" -eq 1 ]; then
    FUNCTION_ETAG="$(aws cloudfront update-function --name "$FUNCTION_NAME" \
      --function-config "Comment=${COMMENT},Runtime=${RUNTIME}" \
      --function-code "fileb://${SOURCE_FILE}" --if-match "$FUNCTION_ETAG" \
      --query 'ETag' --output text)"
    echo "    updated the DEVELOPMENT version"
  else
    FUNCTION_ETAG="$(aws cloudfront create-function --name "$FUNCTION_NAME" \
      --function-config "Comment=${COMMENT},Runtime=${RUNTIME}" \
      --function-code "fileb://${SOURCE_FILE}" --query 'ETag' --output text)"
    echo "    created ${FUNCTION_NAME}"
  fi
  aws cloudfront publish-function --name "$FUNCTION_NAME" --if-match "$FUNCTION_ETAG" >/dev/null
  echo "    published to LIVE"
fi

FUNCTION_ARN="$(aws cloudfront describe-function --name "$FUNCTION_NAME" --stage LIVE \
  --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text 2>/dev/null || echo '')"

# ---------------------------------------------------------------- associate it
if [ "$CURRENT_FUNCTION" = "$FUNCTION_NAME" ]; then
  echo "==> Association already correct; distribution left untouched"
elif [ "$DRY_RUN" = "1" ]; then
  echo "==> Would attach ${FUNCTION_NAME} at viewer-request, replacing ${CURRENT_FUNCTION:-(none)}"
else
  echo "==> Attaching ${FUNCTION_NAME} at viewer-request on the default behaviour"
  [ -n "$FUNCTION_ARN" ] || { echo "cannot resolve the published function ARN" >&2; exit 1; }

  # Rebuilds the config with exactly one field changed, then proves that before sending it.
  python3 - "$WORK/dist.json" "$FUNCTION_ARN" >"$WORK/update.json" <<'PY'
import copy, json, sys

path, arn = sys.argv[1], sys.argv[2]
doc = json.load(open(path))
before = doc['DistributionConfig']
after = copy.deepcopy(before)

after['DefaultCacheBehavior']['FunctionAssociations'] = {
    'Quantity': 1,
    'Items': [{'FunctionARN': arn, 'EventType': 'viewer-request'}],
}

changed = {k for k in after if after[k] != before.get(k)}
if changed != {'DefaultCacheBehavior'}:
    sys.exit('refusing to send a config that also changes: %s' % sorted(changed - {'DefaultCacheBehavior'}))

behaviour_changed = {
    k for k in after['DefaultCacheBehavior']
    if after['DefaultCacheBehavior'][k] != before['DefaultCacheBehavior'].get(k)
}
if behaviour_changed != {'FunctionAssociations'}:
    sys.exit('refusing to send a config that also changes behaviour fields: %s'
             % sorted(behaviour_changed - {'FunctionAssociations'}))

json.dump(after, sys.stdout)
PY

  aws cloudfront update-distribution --id "$DISTRIBUTION_ID" --if-match "$ETAG" \
    --distribution-config "file://$WORK/update.json" >/dev/null
  echo "    submitted; waiting for the distribution to deploy"
  aws cloudfront wait distribution-deployed --id "$DISTRIBUTION_ID"
  echo "    deployed"
fi

# ---------------------------------------------------------------- verify from the outside
DOMAIN="$(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" \
  --query 'Distribution.DomainName' --output text)"

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "Dry run finished. Nothing was created, updated or attached."
  echo "  would verify against https://${DOMAIN}"
  exit 0
fi

echo "==> Verifying https://${DOMAIN}"
FAILED=0

check() {
  local label="$1" url="$2" expect_status="$3" expect_body="$4"
  local status body
  status="$(curl -s -o "$WORK/body" -m 30 -w '%{http_code}' "$url")"
  body="$(head -c 200 "$WORK/body")"
  if [ "$status" = "$expect_status" ] && printf '%s' "$body" | grep -q "$expect_body"; then
    echo "    ok   ${label} (${status})"
  else
    echo "    FAIL ${label}: expected ${expect_status} containing '${expect_body}', got ${status}" >&2
    FAILED=1
  fi
}

# Deep links must serve the shell.
check "deep link /ai/amazon-initial-draft" "https://${DOMAIN}/ai/amazon-initial-draft" 200 '<div id="root"'
check "deep link /login" "https://${DOMAIN}/login" 200 '<div id="root"'
check "route the previous function handled" "https://${DOMAIN}/rto-agent" 200 '<div id="root"'
# The API must still speak JSON, including for its errors.
check "api health" "https://${DOMAIN}/api/health" 200 '"status"'
check "api rejects anonymous access in JSON" "https://${DOMAIN}/api/employees" 401 '"error"'
check "unknown api route stays a JSON 404" "https://${DOMAIN}/api/no-such-route" 404 '"error"'
# A missing asset must not be dressed up as a working page.
check "missing asset is still an error" "https://${DOMAIN}/assets/does-not-exist.js" 403 ''

if [ "$FAILED" -ne 0 ]; then
  echo "==> Verification failed. See the rollback section of" >&2
  echo "    docs/cloudfront-production-configuration.md" >&2
  exit 1
fi

echo ""
echo "Done."
echo "  function     : ${FUNCTION_NAME} (${RUNTIME}), LIVE"
echo "  attached to  : default behaviour (${S3_ORIGIN}) at viewer-request"
echo "  distribution : ${DISTRIBUTION_ID} (${DOMAIN})"
echo "  untouched    : origins, /api routing, cache policies, WAF, custom error responses"
