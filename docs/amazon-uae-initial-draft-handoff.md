# Amazon UAE Initial Draft Generator — Handoff

Status: **planning complete, implementation not started.**
Last updated: 2026-08-23.

This document is a self-contained checkpoint. It carries everything needed to resume the work on another computer without re-running discovery.

Contains no passwords, credentials, connection strings or secrets.

---

## 1. Goal

Add a page under **Amazon → Initial Draft Generator** in the HR & BI app that:

1. Accepts an official Amazon UAE `.xlsx` template uploaded by the user, already containing seller SKUs and product subtypes.
2. Reads the seller SKU from every product row.
3. Matches each SKU exactly against the Life Smile website catalog database.
4. Fills **only blank** Amazon cells with factual data that already exists in that database.
5. Leaves everything it cannot source blank.
6. Returns an initial draft workbook plus a separate data-fetch report.

The user then uploads the draft to ChatGPT separately to write titles, bullet points, descriptions and search terms. Content enhancement is explicitly **not** this feature's job.

Out of scope, permanently: AI content generation, images of any kind, Amazon SP-API, Product Type Definitions API, uploading to Seller Central, job history, approval workflows, price and quantity.

---

## 2. Phase 0 findings (complete)

Discovery was performed read-only through the Cursor MCP server `lifesmile-website-readonly` against database `lifesmiledbnew` (PostgreSQL 17, AWS RDS, eu-central-1).

Only `information_schema` and these catalog tables were queried: `products`, `product_variants`, `product_specifications`, `product_categories`, `sub_categories`, `colors`, `sizes`, `materials`, `product_bundles`, `product_seos`.

Never queried: customers, orders, payments, carts, checkouts, addresses, authentication, tokens, sessions, reviews, wish lists, employees.

### 2.1 Tables that matter

| Table | Live rows | Role |
| --- | --- | --- |
| `products` | 1,059 | Parent or standalone product |
| `product_variants` | 2,181 | Child variant |
| `product_specifications` | 1,063 | Descriptions and spec JSON, keyed on `product_id` |
| `product_categories`, `sub_categories` | — | Category naming |
| `colors`, `sizes`, `materials` | — | Lookup lists, not FK-linked to variants |

`product_images` and `product_videos` exist and are deliberately untouched.

### 2.2 The SKU relationship (most important finding)

**The seller SKU is the `item_code` column, and it lives in either `products` or `product_variants` — never reliably in one.**

Verified against ten real SKUs from the user's template:

- Resolved via `products.item_code`: `LIFEP28-9`, `FLCM-32BS-BLACK`, `LIFESS-15`, `TK1-16`
- Resolved via `product_variants.item_code`: `SPHM-S-HP-32-BLUE`, `TOOL-MIX-5-6-BLUE`, `LIFEP17-MIX-16-1-BLUE`, `LIFEP20-8-FLCRED`, `LIFEP33-10-2`, `SPFHP-28-GRAY`

Each matched exactly one row. Lookup must therefore be a **union across both tables**, not a join descending from `products`.

Parent linkage is `product_variants.product_id`. `products.variant_type` is an enum with values `Single`, `Color`, `Size`, `Multiple`.

Status enums on both tables: `active`, `inactive`, `outOfStock`. Both tables use soft deletes, so every query must filter `deleted_at IS NULL`.

### 2.3 Known data-quality problems

- **3 duplicate `item_code` values inside `products`**: `BRKH-6-`, `BRKH-65`, `SPZDWE`. Each sits on two genuinely different products. Example: `SPZDWE` is both "Pressure Cooker Spare Weight" and "Spare Wessels for Pressure Cooker".
- **35 SKUs appear in both tables.** Roughly 26 have the variant belonging to the same product, which is benign. Roughly 9 have the variant belonging to an unrelated product, for example `AC` is product 540 "Acrylic Water Pitcher" and also variant 861 of a different product. Those are genuinely ambiguous.

### 2.4 Field availability and coverage

Specifications hang off the parent product, so a variant inherits its parent's specs. Colour, size and material are the only genuinely variant-level attributes.

| Field | Source | Coverage |
| --- | --- | --- |
| Title | `products.name` | 1,059 / 1,059 |
| Short description | `product_specifications.short_description` | 1,059, HTML |
| Long description | `product_specifications.long_description` | 1,059, HTML |
| Colour | variant `color`, else product `color` | 1,640 / 113 |
| Size | variant `size`, else product `size` | 1,280 / 48 |
| Material | variant, else product, else `en_specifications.Material` | 829 / 236 / 258 |
| Warranty | `en_specifications.Guarantee` | 216 |
| Stove compatibility | `en_specifications["Stove Compatibility"]` | 166 |
| Weight | `weight_dimensions.Weight` | 200 |
| Dimensions | `weight_dimensions.Dimensions` or `.Dimension` | 212 combined |
| Capacity | `en_specifications.Capacity` | 16 |
| Piece count | `en_specifications.Pieces` | 9 |

### 2.5 The spec JSON is free-form

`en_specifications` and `weight_dimensions` are untyped JSON with inconsistent keys and mixed units. Real observed values:

```json
{"Weight": "16.6kg", "Dimensions": "50.2*35*49.0cm"}
{"Dimension": "23*15.5*14 cm", "Weight": "850 gm"}
{"Dimension": "22*22*24 cm", "Weight": "2.270 Kg"}
{}
```

Consequences for implementation:

- Both `Dimensions` and `Dimension` occur as keys.
- Weight units appear as `kg`, `Kg`, `gm`, `g`.
- Dimensions are a single `L*W*H` string, sometimes with a space before the unit.
- About 40 products use multi-size keys such as `Size 1 Weight`, `Set 2 Dimension`, `Large Weight`, where no single value applies. These must resolve to nothing and be reported.

A fixed set of **website JSON keys** is read through deterministic parsers. This constrains the source data only and has no relationship to Amazon columns, which stay fully dynamic.

### 2.6 Fields with no source anywhere

Brand, manufacturer, model number, EAN/UPC/GTIN, country of origin, coating as a discrete field, included components, and item-level (as opposed to package) dimensions and weight. There is no brand column in this database at all.

---

## 3. Approved decisions

1. **Package, not item.** `weight_dimensions` maps to `package_weight` and `package_length` / `package_width` / `package_height`. All `item_*` measurement columns stay blank. Evidence: `LIFEP28-9` stores 16.6 kg and 50.2\*35\*49.0 cm, identical to the shipping carton recorded in Zoho; `LIFESS-15` stores 850 gm, likewise identical.
2. **Brand constants.** `brand_name` = `Life Smile`, `manufacturer` = `Basmat Al Hayat General Trading LLC`. These match the existing seed in `backend/src/db/index.js` so the Initial Draft Generator and the existing Amazon Bulk Generator agree. Both are declared constants and must be labelled as constants in the report, never presented as fetched data.
3. **Descriptions are stripped, not rewritten.** `product_description` is filled by deterministically stripping HTML from `long_description`, falling back to `short_description`. Tag removal and entity decoding only. No rewording, no summarising, no AI. The original HTML also goes into the report for the ChatGPT step.
4. **Ambiguity is never guessed.** Duplicate `item_code` rows and cross-table overlaps pointing at unrelated products are marked ambiguous. Nothing is written for those rows, and every candidate is listed in the report.
5. **Stateless.** No new tables, no server-side cache, no job history. The browser holds the file and re-sends it for preview, draft and report. The pipeline is a pure function of the upload, so all three calls produce identical results.
6. **Admin only.** The page and all its endpoints are restricted to `role === 'admin'`, matching Amazon Sync Health and Amazon-Zoho Stock.
7. **Price and quantity stay blank.** `standard_price` and `quantity` are never populated.

---

## 4. CRITICAL RULE — Amazon product subtype must never be touched

This is the single most important constraint in the feature. Violating it is a defect.

The generator must **never**:

- hardcode a product type or subtype
- infer a subtype from anything
- select or choose a subtype
- insert a default subtype
- validate a subtype
- maintain an allowlist, denylist, enum or registry of subtypes
- apply subtype-specific field mappings
- apply subtype-specific required-field rules
- reject a workbook because its subtype is unknown, unfamiliar or absent

Positive requirements:

- Columns are discovered **only** from the technical-header row of the workbook uploaded at runtime.
- A header the code does not recognise is skipped and reported. It is never an error.
- Any subtype or product-type column is read-only to this feature. Existing values, including Amazon's prefilled ones, are preserved byte-for-byte.
- Header-row detection keys off the SKU column and header density, never off a subtype column, so a template for any subtype parses identically.
- The same flat mapping table is consulted for every row regardless of that row's subtype.

Consequence: changing or switching subtype in the template requires no code change. Subtype selection and subtype-specific required fields remain entirely the user's responsibility in the template.

The output must never be described as Amazon-upload-ready. It is an initial draft that the user completes and validates separately.

---

## 5. Template-driven architecture

Fully stateless. Three endpoints, all admin-only, each re-running the same pure pipeline.

```
Browser holds the .xlsx
  -> POST /api/amazon-initial-draft/preview   (returns JSON preview)
  -> POST /api/amazon-initial-draft/draft     (returns .xlsx)
  -> POST /api/amazon-initial-draft/report    (returns .xlsx)
  -> GET  /api/amazon-initial-draft/health    (configured + reachable only)

Pipeline:
  parse workbook -> detect technical-header row -> build header->column map
    -> read seller SKUs from data rows
    -> exact match (trimmed) against website catalog, union of products + product_variants
    -> for each detected header, look up the flat mapping table
    -> apply cell policy
    -> emit patched original workbook + separate report workbook
```

### Planned files (none created yet)

Backend:

- `backend/src/db/lifesmileWebsiteDb.js` — dedicated read-only pool
- `backend/src/services/amazonInitialDraft/websiteCatalogRepository.js` — parameterized catalog reads
- `backend/src/services/amazonInitialDraft/amazonTemplateWorkbook.js` — sheet, header row, row classification
- `backend/src/services/amazonInitialDraft/specParsers.js` — JSON key allowlist, `L*W*H` splitter, unit reader, HTML stripper
- `backend/src/services/amazonInitialDraft/unitConversion.js` — deterministic converters
- `backend/src/services/amazonInitialDraft/fieldMapping.js` — the flat header-keyed map
- `backend/src/services/amazonInitialDraft/draftGenerator.js` — orchestration and cell policy
- `backend/src/services/amazonInitialDraft/reportWorkbook.js` — report builder
- `backend/src/controllers/amazonInitialDraftController.js`
- `backend/src/routes/amazonInitialDraft.routes.js`
- mount in `backend/src/app.js`

Frontend:

- `src/api/amazonInitialDraft.ts`
- `src/pages/AmazonInitialDraftPage.tsx`
- route in `src/App.jsx` at `ai/amazon-initial-draft` under the existing `AdminOnly` guard
- nav entry in `AMAZON_NAV_ITEMS` in `src/components/Layout.jsx` with `adminOnly: true`

### Read-only connection requirements

`backend/src/db/lifesmileWebsiteDb.js` is separate from `backend/src/db/index.js`. The HR pool is never reused, and the website database is never used as an application database.

- Reads env var `LIFESMILE_WEBSITE_DATABASE_URL`. Never logged, never returned by an API, never sent to the frontend.
- SSL required.
- `max: 3`, `connectionTimeoutMillis: 5000`, `idleTimeoutMillis: 10000`, `statement_timeout: 15000`.
- Session forced read-only server-side via `options: '-c default_transaction_read_only=on'`, so Postgres itself rejects a write even if application code has a bug.
- `application_name: 'hr-bi-amazon-draft-readonly'` for identification in `pg_stat_activity`.
- `readQuery(sql, params)` rejects any statement that is not `SELECT` or `WITH`, and requires a params array.
- Errors sanitised so a connection string can never surface in a log or stack trace.
- No `ensure*Table`, no DDL, no migrations. Not registered in `testConnection()`.
- Never performs INSERT, UPDATE, DELETE, TRUNCATE, ALTER, DROP or CREATE.

### Catalog query shape

One parameterized `WHERE item_code = ANY($1)` union across `products` and `product_variants`, left-joined to `product_specifications`, `product_categories` and `sub_categories`, filtered on `deleted_at IS NULL`. A single round trip covers the whole upload. Rows resolving to more than one distinct product are returned as ambiguous rather than collapsed.

---

## 6. Flat technical-header-to-resolver mapping design

A single `Map` from technical-header name to a resolver function plus an optional deterministic transform.

- No subtype dimension.
- No branching on product type.
- No required-field metadata.
- No per-subtype overrides.

Resolution is a plain lookup. For each header detected in the uploaded workbook: if the map has an entry, apply it; if not, add the header to the ignored-columns list in the report.

A never-write list takes precedence over everything else and contains: any header matching `/image/i`, the SKU column itself, any subtype or product-type column, `update_delete`, `standard_price`, `quantity`.

### Cell write policy

For every mapped cell on a data row:

- Cell blank → write the value, count as populated.
- Cell already holds the same value → leave unchanged.
- Cell holds a different value → **preserve the existing value**, record a conflict.
- No backend value available → leave blank, record as missing.

User-entered data is never silently overwritten.

---

## 7. Fields allowed for universal mapping

Each entry fires only if that exact technical header exists in the uploaded workbook. Otherwise the entry is inert.

| Technical header | Source |
| --- | --- |
| `item_name` | `products.name` |
| `product_description` | HTML-stripped `long_description`, else `short_description` |
| `brand_name` | constant `Life Smile` |
| `manufacturer` | constant `Basmat Al Hayat General Trading LLC` |
| `color_name` | variant `color`, else product `color` |
| `size_name` | variant `size`, else product `size` |
| `material_type` | variant `material`, else product `material`, else `en_specifications.Material` |
| `warranty_description` | `en_specifications.Guarantee` |
| `capacity` | `en_specifications.Capacity` |
| `number_of_items` | `en_specifications.Pieces` |
| `package_weight` and its unit header | parsed from `weight_dimensions.Weight` |
| `package_length` / `package_width` / `package_height` and their unit header | parsed from the `L*W*H` string |
| `parent_sku`, `parent_child`, `relationship_type`, `variation_theme` | `product_variants.product_id`, `products.variant_type` |

---

## 8. Fields deliberately excluded

**Held back on purpose:**

- `compatible_devices` — the website's `Stove Compatibility` is a cookware-specific notion. Mapping it universally would reintroduce exactly the subtype coupling this design forbids, and it would be wrong on a pitcher or kitchen tool. Its raw value goes to the report only, for the user to place deliberately.

**No source exists:** model number, EAN/UPC/GTIN, country of origin, coating, included components, all item-level measurements, bullet points, generic keywords. Left blank and reported as missing.

**Never written:** every `*image*` column, the SKU column, any subtype or product-type column, `update_delete`, `standard_price`, `quantity`.

**Images are entirely out of scope.** Do not fetch images, inspect S3 records, copy website images, convert WebP, insert URLs, validate images or modify image cells. Image URLs already present in the upload are preserved. The page must display: "Product images are not included. You will upload them separately."

---

## 9. Workbook-preservation requirements

The draft is produced by patching the **original uploaded buffer**, not by rebuilding a workbook.

Must survive untouched:

- all worksheets, including hidden sheets
- header rows and instruction rows
- Amazon's example row
- Amazon's prefilled preference-profile row (the green "We've prefilled attributes from your selected Preference Profiles" row)
- column order
- formulas, formatting, merged cells
- dropdowns and data validation where the library supports them
- every subtype value
- any value the user already entered

No Amazon row or column may be deleted or rearranged. No extra sheet may be added to the Amazon upload workbook.

**Known risk:** ExcelJS does not round-trip every Amazon artifact and can drop data-validation dropdowns on some templates. The existing `backend/src/services/amazonFlatFileExportService.js` already uses the `load` / `writeBuffer` approach as precedent. Verify against the real template first. If ExcelJS damages it, fall back to patching the sheet XML inside the xlsx zip directly, which preserves everything.

Acceptance check: the generated workbook must open without repair warnings.

---

## 10. Report contents

Separate workbook, filename `amazon-uae-initial-draft-report-YYYY-MM-DD.xlsx`. Never merged into the Amazon file.

Per row it must show:

- fields populated
- fields missing from the website database
- existing values preserved
- conflicts preserved
- columns ignored because no approved universal mapping exists

Plus: seller SKU, match status, product database ID, variant database ID, matched product title, unmapped backend values (for example `Stove Compatibility` and the multi-size dimension keys), and any errors or warnings.

Draft filename: `amazon-uae-initial-draft-YYYY-MM-DD.xlsx`, labelled "Initial draft — requires content enhancement and final Amazon validation before upload."

---

## 11. Current blockers

Implementation cannot start until all three are resolved:

1. **The actual Amazon UAE `.xlsx` template.** Needed to determine which header row carries the technical field names, to confirm the exact spelling of the target columns, and to write the workbook-preservation tests against a real file rather than a guess.
2. **A separate `amazon_catalog_reader` runtime role** on the website database, read-only, provisioned by the user. This has not been created and must not be created by the agent.
3. **Final plan approval.**

---

## 12. Credential separation

Two distinct identities that must never be mixed.

| | Discovery | Runtime |
| --- | --- | --- |
| Identity | `cursor_readonly` | `amazon_catalog_reader` (not yet created) |
| Used by | Cursor MCP only | The deployed backend only |
| Configured in | `.cursor/mcp.env` (gitignored) | `backend/.env` (gitignored) |
| Env var | n/a | `LIFESMILE_WEBSITE_DATABASE_URL` |

The Cursor MCP credential must never be copied into `backend/.env` and must never be referenced by application code. No credential of either kind appears in this document, in any committed file, or in any command output.

`.cursor/mcp.json` is portable and secret-free: it sources values from `.cursor/mcp.env` at launch. Both `.cursor/mcp.env` and `.cursor/aws-rds-ca.pem` are gitignored and must be recreated locally on each machine.

---

## 13. Confirmation: no implementation has started

As of this checkpoint:

- No runtime database module exists.
- No API routes, controllers or services for this feature exist.
- No frontend page, route or nav entry exists.
- No migrations were written and none are needed.
- No database role was created.
- No schema-inspection script was added to the repository. Discovery ran entirely through the MCP tool, so no discovery code ships.
- Nothing was committed, pushed or deployed.

The only artifacts produced are this document and the plan file.

---

## 14. Exact next steps to continue from another computer

1. **Clone or pull** the repo and check out the working branch (`rescue/final-restored-candidate` at time of writing).
2. **Install:** `npm install` at the root and `npm install` in `backend/`.
3. **Recreate machine-local files**, both gitignored and therefore absent after a clone:
   - `backend/.env` — copy from `backend/.env.example` and fill in real values.
   - `.cursor/mcp.env` — the MCP discovery credentials, if further schema exploration is wanted. Not required to implement.
   - `.cursor/aws-rds-ca.pem` — the AWS RDS CA bundle, downloadable from AWS. Referenced by `.cursor/mcp.json`. Fetch it from the repository root with:

     ```bash
     curl -fsSL https://truststore.pki.rds.amazonaws.com/eu-central-1/eu-central-1-bundle.pem -o .cursor/aws-rds-ca.pem
     ```

4. **Read this document and the plan file** in `.cursor/plans/`. Phase 0 is done; do not repeat discovery.
5. **Obtain the Amazon UAE `.xlsx` template** and place it somewhere local and gitignored. Do not commit customer-specific templates.
6. **Have the `amazon_catalog_reader` role created** on `lifesmiledbnew`, read-only, then add `LIFESMILE_WEBSITE_DATABASE_URL` to `backend/.env` only.
7. **Implement in phase order:** read-only pool and repository, then workbook engine and mapping, then API and page, then tests.
8. **Verify:** `npm test` at the root (vitest), `npm test` in `backend/` (node --test), `npx tsc --noEmit`, `npm run build`, and a manual save-and-reopen check of the generated workbook.
9. **Do not deploy** until the user approves.

---

## 15. Deployment reference

Commands already defined in the root `package.json`. Recorded here for context only; nothing is to be deployed as part of this feature.

- Frontend: `npm run deploy:frontend` — builds, injects runtime API config, syncs `dist/` to the `hr-lifesmile` S3 bucket, then invalidates the CloudFront distribution.
- Backend: `npm run deploy:backend` — runs `scripts/deploy-backend-production.sh`.
- Both: `npm run deploy:all` — runs `scripts/deploy-all.sh`.
