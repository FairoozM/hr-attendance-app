# CloudFront production configuration: SPA routing and the WAF

Two pieces of edge configuration are load-bearing for this app and neither is visible from the
application source. This document is what stops them from becoming folklore.

For how `/api` is split from the static site in the first place, see
[cloudfront-api-routing.md](./cloudfront-api-routing.md). This document covers what sits on top
of that split.

| Thing | Where it lives | Managed by |
|---|---|---|
| Distribution | `E2YFDZQHMQS2BG` → `d3ci8wu1d5dytp.cloudfront.net` | AWS console / CLI |
| SPA router function | `scripts/cloudfront/spa-router.js`, deployed as `hr-spa-router` | `scripts/deploy-cloudfront-spa-router.sh` |
| WAF web ACL | `CreatedByCloudFront-4a99070f` | CloudFront's built-in security protections |

## 1. Why the SPA needs an edge rewrite

The React app is a single `index.html` plus hashed assets in the `hr-lifesmile` S3 bucket.
Client-side routes such as `/ai/amazon-initial-draft` exist only in the browser's router — there
is no object at that key. S3 answers a request for a missing key with **403**, not 404, because
the bucket policy does not grant `s3:ListBucket`. CloudFront passes that 403 straight through.

The result is that normal in-app navigation works, because the router never asks the network,
while **bookmarking or refreshing any route fails**. Before the fix every deep link was broken:

```
GET /                        200
GET /index.html              200
GET /login                   403
GET /dashboard               403
GET /ai/amazon-initial-draft 403
```

`hr-spa-router` runs at **viewer-request on the default behaviour only** and rewrites paths that
look like client-side routes to `/index.html`, letting the router resolve them. Paths carrying a
file extension are left alone so a genuinely missing bundle keeps failing loudly instead of
turning into a blank page, and anything under `/api` is never touched.

A note on the file's language: `scripts/cloudfront/spa-router.js` is plain JavaScript rather
than TypeScript, which is the repo's default. The CloudFront Functions runtime
(`cloudfront-js-2.0`) executes the uploaded file directly and has no module system or build
step, so the committed bytes must be exactly what runs. Compiling would mean the reviewed source
is not the deployed source.

### The function it replaced

`hr-rto-agent-spa-rewrite` did the same job for exactly one route, `/rto-agent`. CloudFront
allows only **one function per event type per behaviour**, so the general router replaced it
rather than joining it. `spa-router.test.js` keeps a dedicated case for `/rto-agent` so that
route cannot silently regress.

That old function still exists, unassociated, and is deliberately not deleted: it is the
fastest rollback if the general rewrite ever misbehaves.

## 2. Why distribution-wide 403/404 custom error responses must not be used

The advice found in most SPA tutorials is to add custom error responses mapping 403 and 404 to
`/index.html` with response code 200. **Do not do this here.** It would break the API.

Custom error responses are configured **per distribution, not per behaviour**, and they apply to
origin-generated errors as well as CloudFront's own. This distribution serves the Express API
under `/api/*` from the same distribution as the SPA, so such a mapping would rewrite the API's
own error responses:

| Real API response | What the browser would receive |
|---|---|
| `401 {"error":"Unauthorized"}` | `200` + `index.html` |
| `403` from `requireAdmin` | `200` + `index.html` |
| `404 {"error":"API route not found"}` | `200` + `index.html` |

Every frontend `fetch` would then parse HTML as JSON, and an authorization failure would arrive
looking like success. A CloudFront Function attached to a single behaviour is the reason we can
fix SPA routing without touching `/api` at all. `CustomErrorResponses` on this distribution is
`Quantity: 0` and should stay that way.

## 3. The WAF override that keeps workbook uploads working

The distribution is protected by a web ACL that CloudFront created for its built-in security
protections:

- **Web ACL**: `CreatedByCloudFront-4a99070f`, id `d640cee9-3174-46e7-b6e9-5508b671aef1`, scope
  `CLOUDFRONT`, region `us-east-1`, 925 WCU, default action Allow.
- **Rule groups**: `AWSManagedRulesAmazonIpReputationList`, `AWSManagedRulesCommonRuleSet`,
  `AWSManagedRulesKnownBadInputsRuleSet`.

Two Common Rule Set rules are overridden to **Count**:

| Rule | Since | Why |
|---|---|---|
| `SizeRestrictions_BODY` | pre-existing | Bodies over 8 KB are normal here (bulk upserts, uploads). |
| `CrossSiteScripting_BODY` | 2026-08-25 | Blocked Amazon `.xlsm` uploads. See below. |

An `.xlsm` is a ZIP of compressed XML, so the first 8 KB of the body that WAF inspects is
binary noise. Some of those byte sequences match the XSS signature, and WAF answered with its
own **HTML 403** before the request reached Express. The Initial Draft page then reported a
403 with HTML instead of JSON, which looks exactly like an API routing fault and is not one.
Because the match depends on how the compressed bytes fall, it was intermittent: the same
workbook could succeed and then fail.

The surgical fix — exempting only `/api/amazon-initial-draft/*` — needs a WAF **string match
statement**, which AWS gates behind the CloudFront **Pro** flat-rate plan ($15/month per
distribution). This distribution is on the **Free** plan, so the in-plan lever is a global
rule action override.

Setting this rule to Count is an acceptable trade here because the frontend contains no
`dangerouslySetInnerHTML`, no `innerHTML =` assignment and no other raw-HTML sink: React escapes
all rendered output, so injected markup in a request body has nowhere to land. **Revisit this
decision if raw HTML rendering is ever introduced.**

Everything else still blocks, including SQL injection, path traversal (`GenericLFI_BODY`),
XSS in the URI, query string and cookies, IP reputation, and Log4Shell-style known bad inputs.

### Diagnosing a future WAF block

If a request is mysteriously rejected with an HTML 403 that never appears in the backend logs,
ask WAF what it did rather than guessing:

```bash
AWS_PROFILE=abdullah-deploy aws wafv2 get-sampled-requests \
  --scope CLOUDFRONT --region us-east-1 \
  --web-acl-arn "arn:aws:wafv2:us-east-1:260127737691:global/webacl/CreatedByCloudFront-4a99070f/d640cee9-3174-46e7-b6e9-5508b671aef1" \
  --rule-metric-name AWS-AWSManagedRulesCommonRuleSet \
  --time-window StartTime=2026-08-25T08:00:00Z,EndTime=2026-08-25T09:00:00Z \
  --max-items 50 \
  --query 'SampledRequests[].{Action:Action,Rule:RuleNameWithinRuleGroup,URI:Request.URI}' --output table
```

`Action: BLOCK` names the exact rule. Also try the same request directly against the EC2 origin,
bypassing CloudFront entirely: if the origin answers normally, the edge is responsible.

## 4. Deploying and verifying

`scripts/deploy-cloudfront-spa-router.sh` is idempotent. It runs the function's unit tests
first, refuses to continue if the distribution does not have the expected shape (default
behaviour on S3, `/api` and `/api/*` present and not on S3, at most one viewer-request function
and only one it recognises), publishes only when the live code actually differs, changes only
`DefaultCacheBehavior.FunctionAssociations`, and verifies from the outside afterwards.

```bash
# rehearse; changes nothing
DRY_RUN=1 AWS_PROFILE=abdullah-deploy bash scripts/deploy-cloudfront-spa-router.sh

# apply
AWS_PROFILE=abdullah-deploy bash scripts/deploy-cloudfront-spa-router.sh

# just the function's behaviour, no AWS needed
node --test --test-reporter=spec scripts/cloudfront/spa-router.test.js
```

It is intentionally **not** wired into `npm run deploy:all`. Edge configuration changes on its
own schedule, and a routine application deploy should not be able to reshape the distribution.

### Manual verification

Deep links must serve the shell, assets must resolve, a missing asset must still fail, and the
API must keep speaking JSON — including for its errors:

```bash
CF=https://d3ci8wu1d5dytp.cloudfront.net

# frontend routes: 200 text/html
for P in / /login /dashboard /ai/amazon-initial-draft /rto-agent /ai/deep/nested/route; do
  echo "$P -> $(curl -s -o /dev/null -w '%{http_code} %{content_type}' $CF$P)"
done

# assets: the real one resolves, a missing one must NOT become 200 index.html
curl -s -o /dev/null -w 'asset %{http_code}\n' "$CF/$(curl -s $CF/index.html | grep -o 'assets/[A-Za-z0-9._-]*\.js' | head -1)"
curl -s -o /dev/null -w 'missing asset %{http_code} (expect 403)\n' $CF/assets/does-not-exist.js

# API status codes and JSON bodies
curl -s -w ' <- %{http_code}\n' $CF/api/health           # 200 {"status":"ok"}
curl -s -w ' <- %{http_code}\n' $CF/api/employees        # 401 {"error":"Unauthorized"}
curl -s -w ' <- %{http_code}\n' $CF/api/no-such-route    # 404 {"error":"API route not found"}
```

Expected results:

| Request | Status | Body |
|---|---|---|
| `/`, `/login`, `/dashboard`, any client route | 200 | `text/html`, contains `<div id="root"`  |
| real hashed asset | 200 | the asset |
| `/assets/does-not-exist.js` | 403 | S3 error, **not** `index.html` |
| `/api/health` | 200 | `{"status":"ok"}` |
| `/api/employees` unauthenticated | 401 | `{"error":"Unauthorized"}` |
| `/api/no-such-route` | 404 | `{"error":"API route not found"}` |

To confirm the WAF override still permits uploads, post a workbook to the preview endpoint
without credentials. **401 means it reached Express**, which is the point; a 403 with an HTML
body means WAF blocked it again:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://d3ci8wu1d5dytp.cloudfront.net/api/amazon-initial-draft/preview \
  -F "file=@some-amazon-template.xlsm"
```

## 5. Rollback

### Detach the SPA router (deep links return to 403)

```bash
export AWS_PROFILE=abdullah-deploy
aws cloudfront get-distribution-config --id E2YFDZQHMQS2BG > /tmp/dist.json
python3 - <<'PY'
import json
doc = json.load(open('/tmp/dist.json'))
cfg = doc['DistributionConfig']
cfg['DefaultCacheBehavior']['FunctionAssociations'] = {'Quantity': 0}
json.dump(cfg, open('/tmp/rollback.json', 'w'))
open('/tmp/etag', 'w').write(doc['ETag'])
PY
aws cloudfront update-distribution --id E2YFDZQHMQS2BG \
  --if-match "$(cat /tmp/etag)" --distribution-config file:///tmp/rollback.json
aws cloudfront wait distribution-deployed --id E2YFDZQHMQS2BG
```

### Restore the previous narrow function instead

Same as above, but set the association rather than clearing it. This restores the
`/rto-agent`-only behaviour and nothing else:

```python
cfg['DefaultCacheBehavior']['FunctionAssociations'] = {
    'Quantity': 1,
    'Items': [{
        'FunctionARN': 'arn:aws:cloudfront::260127737691:function/hr-rto-agent-spa-rewrite',
        'EventType': 'viewer-request',
    }],
}
```

### Restore `CrossSiteScripting_BODY` to Block (workbook uploads will fail again)

```bash
export AWS_PROFILE=abdullah-deploy
ACL_ID=d640cee9-3174-46e7-b6e9-5508b671aef1
aws wafv2 get-web-acl --scope CLOUDFRONT --region us-east-1 \
  --name CreatedByCloudFront-4a99070f --id $ACL_ID > /tmp/acl.json
python3 - <<'PY'
import json
doc = json.load(open('/tmp/acl.json'))
acl = doc['WebACL']
for rule in acl['Rules']:
    mrg = rule['Statement'].get('ManagedRuleGroupStatement', {})
    if 'RuleActionOverrides' in mrg:
        mrg['RuleActionOverrides'] = [
            o for o in mrg['RuleActionOverrides'] if o['Name'] != 'CrossSiteScripting_BODY'
        ]
allowed = {'Name', 'Id', 'DefaultAction', 'Description', 'Rules', 'VisibilityConfig',
           'CustomResponseBodies', 'CaptchaConfig', 'ChallengeConfig', 'TokenDomains',
           'AssociationConfig', 'DataProtectionConfig'}
payload = {k: v for k, v in acl.items() if k in allowed and v != ''}
payload['Scope'] = 'CLOUDFRONT'
payload['LockToken'] = doc['LockToken']
json.dump(payload, open('/tmp/acl-update.json', 'w'))
PY
aws wafv2 update-web-acl --region us-east-1 --cli-input-json file:///tmp/acl-update.json
```

Two traps worth knowing before you run that. The web ACL's `Description` is an **empty string**,
and `update-web-acl` rejects a zero-length description, which is why the snippet drops empty
values. And because this ACL belongs to a CloudFront pricing plan, it accepts only a restricted
feature set: adding a `ScopeDownStatement` or any other string match fails with
`WAFFeatureNotIncludedInPricingPlanException`, naming `PRO` as the required plan.
