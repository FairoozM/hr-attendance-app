# Weekly Reports — Zoho Webhook Integration Contract (FINAL)

This document is the source of truth for how the HR backend talks to the
Zoho-side Deluge function that powers every Weekly Report (Slow Moving,
Other Family, etc.).

It is intentionally strict: the HR backend treats Zoho as the only authority
for business numbers, so any ambiguity in the response is treated as a bug
on the Zoho side and surfaced as an error rather than silently coerced.

- HR backend client:           [`backend/src/services/zohoService.js`](../backend/src/services/zohoService.js)
- HR backend controller:       [`backend/src/controllers/weeklyReportsController.js`](../backend/src/controllers/weeklyReportsController.js)
- Sample Deluge implementation:[`docs/weekly-reports-zoho-webhook.deluge`](./weekly-reports-zoho-webhook.deluge)

---

## 1. Request — what the HR backend sends to Zoho

| Property      | Value                                                      |
|---------------|------------------------------------------------------------|
| Method        | `GET`                                                      |
| URL           | `${ZOHO_REPORT_WEBHOOK_URL}`                               |
| Auth header   | `${ZOHO_REPORT_WEBHOOK_HEADER_NAME}: ${ZOHO_REPORT_WEBHOOK_AUTH_HEADER}` (header name defaults to `Authorization`) |
| `Accept`      | `application/json`                                         |
| Query params  | `from_date=YYYY-MM-DD`, `to_date=YYYY-MM-DD`               |
| Date semantics| Inclusive at both ends, in the operator's local timezone   |
| Timeout       | `ZOHO_REPORT_WEBHOOK_TIMEOUT_MS` (default `20000` ms)      |
| Retries       | None — every call is independent and idempotent            |

Query-param names can be overridden via `ZOHO_REPORT_WEBHOOK_FROM_PARAM` and
`ZOHO_REPORT_WEBHOOK_TO_PARAM` if Zoho expects different keys.

### Example request

```http
GET /server/weekly_inventory?from_date=2026-04-13&to_date=2026-04-19 HTTP/1.1
Host: www.zohoapis.com
Accept: application/json
Authorization: Zoho-oauthtoken 1000.<your-token>
```

The HR backend never sends a request body. The full date range is in the
URL.

---

## 2. Response — what Zoho must return

### 2.1 Status code

`200 OK` for any successful response, **including the case where no items
moved during the date range** (return `{ "items": [] }`, not 404 or 204).

Any non-2xx status causes the HR backend to surface
`ZOHO_WEBHOOK_HTTP_ERROR`.

### 2.2 Top-level shape

The HR backend accepts both shapes — pick one and stay consistent:

```jsonc
// Recommended
{
  "items": [ ...itemRows... ]
}
```

```jsonc
// Also accepted
[ ...itemRows... ]
```

Anything else (object without `items`, top-level number/string, etc.)
fails as `WEBHOOK_INVALID_RESPONSE`.

### 2.3 Per-item row schema

Each row is a JSON object with exactly these fields:

| Field                   | Type           | Required | Notes                                                                                                                       |
|-------------------------|----------------|----------|-----------------------------------------------------------------------------------------------------------------------------|
| `sku`                   | `string`       | YES      | **Primary match key.** Non-empty after trimming. Used to join against `item_report_groups.sku` (case-insensitive).           |
| `item_name`             | `string`       | no       | Display label shown in the report's `ITEM` column. Strongly recommended for human readability.                              |
| `item_id`               | `string`       | no       | Zoho's internal item id. Stored verbatim, used only for traceability.                                                       |
| `opening_stock`         | `number\|null` | no       | Number of units in stock at `from_date 00:00`.                                                                              |
| `purchases`             | `number\|null` | no       | Units purchased during the range. Already aggregated by Zoho.                                                               |
| `returned_to_wholesale` | `number\|null` | no       | Units returned to wholesale during the range.                                                                               |
| `closing_stock`         | `number\|null` | no       | Number of units in stock at `to_date 23:59:59`.                                                                             |
| `sold`                  | `number\|null` | no       | Units sold during the range. **Authoritative — never derived in HR.**                                                       |

**Strictness rules:**

1. `sku` is the only required identifier. A row without `sku` is rejected.
2. Numeric fields **must** be JSON numbers (e.g. `0`, `1152`, `12.5`). The
   strings `"0"` or `"1152"` are rejected.
3. A numeric field that is `null` or absent defaults to `0`. This is
   interpreted as "Zoho explicitly returned no value, meaning no movement
   for this item in this period."
4. `NaN`, `Infinity`, booleans, arrays, and objects are rejected for
   numeric fields.
5. Negative values are accepted (Zoho may legitimately report negative
   stock movements such as adjustments). The report renders them verbatim.

### 2.4 Example — well-formed response

```json
{
  "items": [
    {
      "sku": "FL-SHINE-001",
      "item_name": "FL SHINE",
      "item_id": "12345",
      "opening_stock": 12980,
      "purchases": 0,
      "returned_to_wholesale": 0,
      "closing_stock": 11828,
      "sold": 1152
    },
    {
      "sku": "LIFEP2N-001",
      "item_name": "LIFEP2N",
      "opening_stock": 540,
      "purchases": null,
      "returned_to_wholesale": null,
      "closing_stock": 532,
      "sold": 8
    }
  ]
}
```

Both rows are valid:
- Row 1 is fully populated.
- Row 2 omits `item_id` and uses `null` for "no movement" fields — the HR
  backend stores them as `0`.

### 2.5 Example — rejected response

```json
{
  "items": [
    { "sku": "FL-SHINE-001", "sold": "1152" },
    { "item_name": "Mystery Item", "sold": 4 },
    { "sku": "X-1", "opening_stock": "n/a" }
  ]
}
```

The HR backend would respond with HTTP 502 and:

```json
{
  "error": "Zoho webhook returned an invalid response (3 validation errors):\n  1. ...",
  "code": "WEBHOOK_INVALID_RESPONSE",
  "validation_errors": [
    "items[0] (sku=\"FL-SHINE-001\"): field \"sold\" must be a JSON number (or null/absent for 0). Got string: \"1152\".",
    "items[1]: \"sku\" is required and must be a non-empty string.",
    "items[2] (sku=\"X-1\"): field \"opening_stock\" must be a JSON number (or null/absent for 0). Got string: \"n/a\"."
  ]
}
```

---

## 3. Match contract — how rows are mapped to a report

The HR `item_report_groups` table maps SKUs to logical buckets (`slow_moving`,
`other_family`, …).

Matching algorithm executed on every report request:

1. Backend loads `members = SELECT sku, item_name FROM item_report_groups WHERE report_group=$1 AND active=true`.
2. Backend asks the Deluge webhook for the date range and validates strictly.
3. For each validated row from Zoho:
   - **Primary match**: `row.sku` (case-insensitively) matches a member's `sku`.
   - **Legacy fallback**: only if the member has no `sku` populated, the
     backend will fall back to comparing `row.item_name` against
     `member.item_name`. New entries should always include a SKU.
4. Only matched rows are returned to the frontend. The Grand Total row is
   computed by summing the matched rows' numeric fields verbatim.

If Zoho returns an item that's not in the group, it is dropped. If the group
has a member that Zoho didn't return, the report **does not** display a
synthetic zero row — it simply doesn't show. This is by design: the report
reflects what Zoho actually returned for the period.

---

## 4. Validation summary

| Layer           | Rule                                                                                                  | On failure                                                  |
|-----------------|-------------------------------------------------------------------------------------------------------|-------------------------------------------------------------|
| Transport       | HTTP 2xx                                                                                              | `ZOHO_WEBHOOK_HTTP_ERROR` → HTTP 502                        |
| Transport       | Response received before timeout                                                                      | `ZOHO_WEBHOOK_TIMEOUT` → HTTP 504                           |
| Body            | Body parses as JSON                                                                                   | `WEBHOOK_INVALID_RESPONSE` → HTTP 502                       |
| Shape           | Body is `{items:[…]}`, `{data:[…]}`, or a bare array                                                  | `WEBHOOK_INVALID_RESPONSE` → HTTP 502                       |
| Row             | Row is a JSON object                                                                                  | `WEBHOOK_INVALID_RESPONSE` → HTTP 502                       |
| Row.sku         | Non-empty string                                                                                      | `WEBHOOK_INVALID_RESPONSE` → HTTP 502                       |
| Row.numeric     | Number, or `null`/absent (treated as 0)                                                               | `WEBHOOK_INVALID_RESPONSE` → HTTP 502                       |
| Configuration   | `ZOHO_REPORT_WEBHOOK_URL` and `ZOHO_REPORT_WEBHOOK_AUTH_HEADER` both set                              | `ZOHO_NOT_CONFIGURED` → HTTP 503                            |

The HR backend collects up to the first 10 row-level validation errors and
returns them all in `validation_errors`, so a misconfigured Deluge function
can be debugged in one round-trip.

---

## 5. Backend error contract for the frontend

The HR API responds in a uniform shape. Frontend consumers (e.g.
`src/hooks/useWeeklySalesReport.js`) match on `code`:

```jsonc
// 503
{ "error": "Zoho source not configured. ...", "code": "ZOHO_NOT_CONFIGURED" }

// 504
{ "error": "Zoho webhook request timed out after 20000ms", "code": "ZOHO_WEBHOOK_TIMEOUT" }

// 502 — non-2xx from Zoho
{ "error": "Zoho webhook responded with HTTP 401: ...", "code": "ZOHO_WEBHOOK_HTTP_ERROR" }

// 502 — body parsed but failed strict validation
{ "error": "Zoho webhook returned an invalid response (...): ...",
  "code": "WEBHOOK_INVALID_RESPONSE",
  "validation_errors": ["items[0] (sku=...): ...", ...] }

// 502 — generic network / DNS / TLS failure
{ "error": "...", "code": "ZOHO_WEBHOOK_NETWORK_ERROR" }
```

Every other error path falls through to a plain HTTP 502 with `error`.

---

## 6. README — configuring & testing the webhook

### 6.1 One-time setup on the Zoho side

1. Open Zoho Inventory → **Setup → Functions → Deluge**.
2. Create a new function (e.g. `weekly_inventory_report`) using the sample at
   [`docs/weekly-reports-zoho-webhook.deluge`](./weekly-reports-zoho-webhook.deluge).
3. **Publish it as a REST endpoint** (Deluge → "Publish as REST API"). Note
   down the resulting URL — that is your `ZOHO_REPORT_WEBHOOK_URL`.
4. Generate an OAuth token (or any authentication scheme your Zoho org uses)
   that the HR backend will send. Save the full header value as
   `ZOHO_REPORT_WEBHOOK_AUTH_HEADER`. Examples:
   - OAuth token: `Zoho-oauthtoken 1000.abcdef...`
   - Bearer token: `Bearer eyJhbGc...`
   - Custom header: header name in `ZOHO_REPORT_WEBHOOK_HEADER_NAME`,
     value in `ZOHO_REPORT_WEBHOOK_AUTH_HEADER`.
5. Verify the function returns the strict shape from §2.3 above. The
   sample Deluge enforces this on its own side too.

### 6.2 Backend environment variables

Add to the **backend** `.env` (these are read by Node; do **not** prefix with
`VITE_`):

```bash
ZOHO_REPORT_WEBHOOK_URL=https://www.zohoapis.com/server/weekly_inventory
ZOHO_REPORT_WEBHOOK_AUTH_HEADER="Zoho-oauthtoken 1000.your.token"

# Optional overrides — defaults shown
# ZOHO_REPORT_WEBHOOK_HEADER_NAME=Authorization
# ZOHO_REPORT_WEBHOOK_FROM_PARAM=from_date
# ZOHO_REPORT_WEBHOOK_TO_PARAM=to_date
# ZOHO_REPORT_WEBHOOK_TIMEOUT_MS=20000
```

Restart the backend after changes — the env vars are read at request time,
but the connection pool / process should be cycled to pick up other changes.

### 6.3 Sanity-check the webhook in 30 seconds

Replace the placeholders, then run:

```bash
curl -i \
  -H "Authorization: Zoho-oauthtoken 1000.your.token" \
  -H "Accept: application/json" \
  "https://www.zohoapis.com/server/weekly_inventory?from_date=2026-04-13&to_date=2026-04-19"
```

Expected: `HTTP/1.1 200 OK` with a JSON body whose top-level `items` is an
array of objects matching §2.3.

### 6.4 End-to-end test through the HR API

With the backend running locally:

```bash
# Generic group endpoint (preferred):
curl -s -H "Cookie: $YOUR_AUTH_COOKIE" \
  "http://localhost:3001/api/weekly-reports/by-group/slow_moving?from_date=2026-04-13&to_date=2026-04-19" | jq .

# Legacy back-compat alias:
curl -s -H "Cookie: $YOUR_AUTH_COOKIE" \
  "http://localhost:3001/api/weekly-reports/slow-moving?from_date=2026-04-13&to_date=2026-04-19" | jq .
```

Successful response shape:

```jsonc
{
  "report_group": "slow_moving",
  "from_date": "2026-04-13",
  "to_date": "2026-04-19",
  "items": [ /* matched, validated rows */ ],
  "totals": {
    "opening_stock": 0, "purchases": 0,
    "returned_to_wholesale": 0, "closing_stock": 0, "sold": 0
  }
}
```

### 6.5 Common failure modes & how to fix them

| Symptom (HTTP / `code`)                       | Likely cause                                                             | Fix                                                                                          |
|-----------------------------------------------|--------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| `503 ZOHO_NOT_CONFIGURED`                     | `ZOHO_REPORT_WEBHOOK_URL` or `_AUTH_HEADER` missing on the backend       | Set both env vars and restart the backend                                                    |
| `504 ZOHO_WEBHOOK_TIMEOUT`                    | Deluge function takes too long, or wrong URL / DNS                       | Optimise the Deluge function, or raise `ZOHO_REPORT_WEBHOOK_TIMEOUT_MS`                     |
| `502 ZOHO_WEBHOOK_HTTP_ERROR (HTTP 401/403)`  | Auth header is wrong or expired                                          | Refresh the OAuth token / regenerate the secret and update `ZOHO_REPORT_WEBHOOK_AUTH_HEADER` |
| `502 WEBHOOK_INVALID_RESPONSE`                | Deluge returned a row missing `sku`, or sent a numeric value as a string | Read `validation_errors[]` — the row index and field are listed; fix the Deluge function     |
| `200` but report is empty                     | `items` array is `[]`, OR returned SKUs don't match `item_report_groups` | Check `validation_errors[]` is empty (it should be); confirm SKUs are in `item_report_groups`|

### 6.6 Adding a new report group

**Recommended (admin UI, no DB access needed):**

1. As an admin, open **Admin → Item Report Groups** in the sidebar (route
   `/admin/item-report-groups`).
2. Click **Add Mapping**, choose **Create new group key** (e.g. `high_priority`),
   and add each item — **always with a non-empty SKU** matching what Zoho
   returns. Edit / Activate / Deactivate / Delete are available per row.
3. Wire a new route in `src/App.jsx` that renders `<WeeklySalesReportPage
   reportGroup="high_priority" title="Weekly High Priority Sales Report" />`.
4. Add a sidebar link in `src/components/Layout.jsx` under `REPORTS_ITEMS`.

**Alternative (raw SQL, e.g. for bulk seeding):**

```sql
INSERT INTO item_report_groups (sku, item_name, report_group, notes)
VALUES
  ('SKU-1', 'Display Name 1', 'high_priority', 'manual addition'),
  ('SKU-2', 'Display Name 2', 'high_priority', 'manual addition');
```

No backend or Deluge changes are required — the generic `/api/weekly-reports/
by-group/:group` endpoint handles every group, and the admin UI hits the
generic `/api/item-report-groups` admin API, which is restricted to admins.

---

## 7. Bulk Import from CSV (admin productivity)

For seeding many mappings at once, the admin UI exposes a CSV-driven
upsert flow. This is **additive** — single-row Add/Edit/Delete still works
exactly as before.

- Backend controller:  [`backend/src/controllers/itemReportGroupsController.js`](../backend/src/controllers/itemReportGroupsController.js) (`bulkImport` / `bulkImportDryRun`)
- Backend service:     [`backend/src/services/itemReportGroupsService.js`](../backend/src/services/itemReportGroupsService.js) (`findMatch`, `bulkUpsertTx`)
- CSV parser:          [`backend/src/utils/csv.js`](../backend/src/utils/csv.js)
- Frontend modal:      [`src/pages/admin/BulkImportModal.jsx`](../src/pages/admin/BulkImportModal.jsx)

### 7.1 Endpoints (admin only)

| Method | Path                                       | Purpose                                                  |
|--------|--------------------------------------------|----------------------------------------------------------|
| `POST` | `/api/item-report-groups/import/dry-run`   | Validate CSV without writing; returns the planned diff.  |
| `POST` | `/api/item-report-groups/import`           | Validate **and commit** in a single transaction.         |

Both endpoints accept a JSON body of `{ "csv": "<file contents as text>" }`
and require the same admin auth as the rest of the admin API.

### 7.2 CSV format

```csv
report_group,sku,item_id,item_name,active,notes
slow_moving,FL-SHINE-001,,FL SHINE,true,seeded item
slow_moving,LIFEP2N-001,,LIFEP2N,true,
other_family,LIFEP7S-001,,LIFEP7S,true,
other_family,,,LIFEP19,true,name-only fallback
```

| Column         | Required | Notes                                                                                              |
|----------------|----------|----------------------------------------------------------------------------------------------------|
| `report_group` | yes      | Lowercase `[a-z0-9]([a-z0-9_-]{0,62}[a-z0-9])`. Auto-lowercased before save.                       |
| `sku`          | one of   | Preferred match key. ≤ 100 chars.                                                                  |
| `item_id`      | the      | Zoho `item_id`. ≤ 100 chars.                                                                       |
| `item_name`    | three    | Display name and last-resort match key. ≤ 255 chars.                                               |
| `active`       | no       | `true`/`false`, `yes`/`no`, `1`/`0`. Defaults to `true` when omitted.                              |
| `notes`        | no       | Free-form.                                                                                         |

A row with **none** of `sku` / `item_id` / `item_name` is rejected as invalid.
Unknown extra columns are returned in `summary.unknown_headers` and ignored.
Quoted values, embedded commas, escaped `""`, CRLF/LF, and a UTF-8 BOM are
all handled. The parser caps imports at **5,000 rows** per request.

### 7.3 Matching priority (upsert)

For each CSV row, the importer looks for an existing mapping in the same
`report_group` using this priority and stops at the first hit:

1. `sku` (case-insensitive)
2. `item_id` (exact)
3. `item_name` (case-insensitive)

If a match is found → that row is **updated**; otherwise it's **created**.
Within a single CSV, two rows that resolve to the same identifier in the
same `report_group` are flagged as `invalid` (you cannot upsert the same
target twice in one batch).

### 7.4 Dry run vs Import

- **Dry run** parses, normalises, and classifies every row, returning a
  preview without touching the database.
- **Import** runs the same planner; if **any** row is invalid the request
  is refused with HTTP `422 IMPORT_HAS_INVALID_ROWS` and the plan is
  returned so the admin can fix the CSV. Otherwise every create/update is
  committed inside a single transaction — if any one statement fails the
  entire batch is rolled back. There is no partial import.

#### Import modes (`mode` body field)

| Value           | Behaviour                                                                                                                                                                                                                |
|-----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `upsert` (default) | Match-or-create per row. Existing rows not present in the CSV are left untouched.                                                                                                                                      |
| `replace_group` | **Destructive.** For every distinct `report_group` present in the validated CSV rows, every active row is deactivated **first**, inside the same transaction. Then the CSV is upserted. Rows missing from the CSV stay deactivated. Untouched groups are never modified. The dry-run includes a `replace_preview` block with current active counts per affected group; the import response includes a matching `replace_result` with the actual deactivation counts. The admin UI requires typing `REPLACE` to confirm. |

**Safety guard**: a `replace_group` import where no valid CSV row applies
(zero creates + zero updates) is rejected with HTTP `400` and code
`REPLACE_GROUP_EMPTY_CSV` — we never deactivate a group based on an
all-invalid CSV.

### 7.5 Results table (admin UI)

Both the dry-run preview and the post-import results render the same
row-level table:

| Row  | Report Group   | SKU            | Item ID  | Item Name | Action  | Status      | Message                                      |
|------|----------------|----------------|----------|-----------|---------|-------------|----------------------------------------------|
| 2    | `slow_moving`  | `FL-SHINE-001` | —        | FL SHINE  | create  | Will create | Eligible to create                           |
| 3    | `slow_moving`  | `FL-OLD-001`   | —        | FL OLD    | update  | Will update | Matches existing #11 (was: FL OLD legacy)    |
| 4    | `slow_moving`  | —              | —        | —         | invalid | Invalid     | At least one of sku, item_id, or item_name…  |

After a real import, **Status** becomes `Created` / `Updated` and **Message**
includes the new row id.

### 7.6 Response shape

```jsonc
{
  "mode": "dry_run",            // or "import"
  "committed": true,            // only present on a successful import
  "headers": ["report_group", "sku", ...],
  "summary": {
    "total_rows":       4,
    "to_create":        3,
    "to_update":        1,
    "invalid":          0,
    "duplicate_in_csv": 0,
    "unknown_headers":  []
  },
  "rows": [
    {
      "row_number": 2,
      "action": "create",       // create | update | invalid
      "normalized": { "report_group": "slow_moving", "sku": "FL-SHINE-001", ... },
      "existing_id": 11,        // present when action === "update"
      "existing": { ... },      // pre-update snapshot, present on updates
      "errors":  [ ... ],       // present when action === "invalid"
      "id": 73,                 // assigned id, only after successful import
      "result_action": "create" // only after successful import
    }
  ]
}
```

### 7.7 Error contract

| HTTP / `code`                        | Meaning                                                                  |
|--------------------------------------|--------------------------------------------------------------------------|
| `400 CSV_BODY_MISSING`               | Body missing the `csv` field.                                            |
| `400 CSV_PARSE_ERROR`                | CSV could not be parsed (e.g. unterminated quote). Includes line number. |
| `400 CSV_NO_ROWS`                    | Header present but no data rows.                                         |
| `400 CSV_MISSING_HEADERS`            | `report_group` column missing.                                           |
| `400 CSV_TOO_LARGE`                  | More than 5,000 data rows in one request.                                |
| `422 IMPORT_HAS_INVALID_ROWS`        | Real import refused; plan returned so the admin can fix the CSV.         |
| `409 IMPORT_UNIQUE_VIOLATION`        | DB unique constraint hit during commit — the whole batch was rolled back.|
| `500`                                | Unexpected commit error; transaction rolled back. Detail in the body.    |

### 7.8 Audit log

A successful import emits one audit line per request, with the same actor
tagging as the rest of the admin writes:

```
[item-report-groups][audit] actor=user:42/role:admin {"action":"bulk_import","total_rows":4,"created":3,"updated":1}
```

### 7.9 In-app import log (last 10 attempts)

The admin page also exposes a UI-friendly view of the most recent attempts
via the **Import Log** button in the page header. It is backed by:

* `GET /api/item-report-groups/import/log` — returns the last 10 entries.
* The `item_report_groups_import_log` table — one row per commit attempt,
  success or failure. Older rows are pruned automatically *inside the same
  transaction* that records a new entry, so the table stays bounded without
  an external job.

Each entry stores: timestamp, acting `user_id`/`user_role`, import `mode`,
`total_rows`, `created_count`, `updated_count`, `invalid_count`,
`deactivated_count` (replace_group only), `succeeded`, and a short
`error_code` if it failed (e.g. `IMPORT_UNIQUE_VIOLATION`).

Rejected dry-runs and 422 "fix invalid rows first" responses are *not*
recorded — the log is a record of attempts that actually touched the DB.
