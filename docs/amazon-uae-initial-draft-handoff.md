# Amazon UAE Initial Draft Generator — Handoff

Status: **planning complete, template discovery complete, implementation not started.**
Last updated: 2026-08-24.

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

**Corrected against the real template (see section 16).** The field names originally guessed here — `brand_name`, `color_name`, `size_name`, `material_type`, `package_weight`, `parent_child`, `relationship_type` — do **not** exist. Amazon's real headers are marketplace-qualified and occurrence-indexed. All 22 targets below were verified present in the uploaded workbook.

| Col | Exact technical header | Source |
| --- | --- | --- |
| G | `item_name[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#1.value` | `products.name` |
| AD | `product_description[…][language_tag=en_AE]#1.value` | HTML-stripped `long_description`, else `short_description` |
| I | `brand[…][language_tag=en_AE]#1.value` | constant `Life Smile` |
| S | `manufacturer[…][language_tag=en_AE]#1.value` | constant `Basmat Al Hayat General Trading LLC` |
| AR | `color[…][language_tag=en_AE]#1.value` | variant `color`, else product `color` |
| AS | `size[…][language_tag=en_AE]#1.value` | variant `size`, else product `size` |
| AK | `material[…][language_tag=en_AE]#1.value` | variant `material`, else product `material`, else `en_specifications.Material` |
| HR | `warranty_description[…][language_tag=en_AE]#1.value` | `en_specifications.Guarantee` |
| BA / BB | `capacity[…]#1.value` / `#1.unit` | `en_specifications.Capacity`, split into number and unit |
| AP | `number_of_items[…]#1.value` | `en_specifications.Pieces` |
| HJ / HK | `item_package_weight[…]#1.value` / `#1.unit` | parsed from `weight_dimensions.Weight` |
| HD / HE | `item_package_dimensions[…]#1.length.value` / `.unit` | L of the `L*W*H` string |
| HF / HG | `item_package_dimensions[…]#1.width.value` / `.unit` | W of the `L*W*H` string |
| HH / HI | `item_package_dimensions[…]#1.height.value` / `.unit` | H of the `L*W*H` string |
| D | `parentage_level[…]#1.value` | derived: variant row → `Child`, product row → `Parent` |
| E | `child_parent_sku_relationship[…]#1.parent_sku` | parent `products.item_code` via `product_variants.product_id` |
| F | `variation_theme#1.name` | `products.variant_type` |

`[…]` abbreviates `[marketplace_id=A2VIGQ35RCS4UG]`. There is no `relationship_type` column in this template; parentage is expressed by `parentage_level` plus `child_parent_sku_relationship`.

### Header matching must normalise, not string-compare

A literal `Map` keyed on the full header string would break the moment Amazon changes a marketplace ID, language tag or occurrence index. Match on a normalised key instead: strip `[qualifier=value]` groups and `#N` indices, keep the attribute path and the trailing field. So

```
item_package_dimensions[marketplace_id=A2VIGQ35RCS4UG]#1.length.unit
  -> item_package_dimensions.length.unit
```

This stays completely subtype-agnostic: normalisation is textual and has no product-type dimension. Where an attribute occupies several columns (25 attributes span 113 columns, for example `material` at AK–AO), fill only the first slot and report the rest as intentionally untouched.

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

**Resolved: ExcelJS cannot be used. Direct worksheet-XML patching is mandatory.**

This was tested against the real template, and ExcelJS does not merely damage the workbook — it never finishes loading it. `workbook.xlsx.load()` ran for over ten minutes at 100% CPU and 847 MB RSS without completing, and had to be killed. A stack sample showed V8 inside `NameDictionary::Add` and `__introsort`, the signature of adding a pathological number of dynamic string keys to one object.

The cause is structural, not a matter of tuning. ExcelJS expands every `sqref` range into a per-cell-address entry, and this template declares its validations and conditional formatting over whole columns to Excel's row limit:

| Artifact | Declared over | Cell addresses ExcelJS would key |
| --- | --- | --- |
| 402 data validations | e.g. `B8:B1048576` | 328,202,413 |
| 194 conditional formats | e.g. `D8:AT1048576` | 687,861,264 |
| 3,829 range defined names | `Dropdown Lists` columns | 118,746 |

Removing the defined names alone does not help; the validation and formatting ranges are the dominant cost. No ExcelJS version can load this file, so `amazonFlatFileExportService.js` is **not** a usable precedent here.

openpyxl is not an alternative writer either: it loads the file but warns "Data Validation extension is not supported and will be removed", so it would silently drop the three `x14` subtype-conditional dropdowns.

### The patching approach, verified

Treat the upload as an OPC zip. Rewrite only `xl/worksheets/sheet5.xml` (the `Template` sheet) and stream every other part through byte-for-byte, preserving zip entry order and metadata.

Writing a cell: row elements already exist for rows 8–56, and empty cells carry a style (`<c r="A8" s="104"/>`). Patch such a placeholder in place, keeping its `s` attribute, and write the value as an inline string:

```xml
<c r="G8" s="104" t="inlineStr"><is><t xml:space="preserve">value</t></is></c>
```

Inline strings mean `xl/sharedStrings.xml` never changes, which removes a whole class of index-corruption risk. Cells must be inserted in ascending column order within the row.

Measured result of a real patch of five cells across rows and column groups:

- 43 of 44 package parts byte-identical; only `sheet5.xml` changed, by 429 bytes
- 399 standard validations, 3 `x14` extension validations, 194 conditional formats, 9 merged ranges, 4,437 defined names, all 10 sheets and the macro-enabled content type all preserved
- the source file's SHA-256 was unchanged before and after
- openpyxl, an independent implementation, opens the patched file and reports identical structure, with the written values present

Acceptance check: the generated workbook must open without repair warnings, and every part except the patched sheet must be byte-identical to the upload. Both are now automated assertions rather than manual checks.

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

1. ~~**The actual Amazon UAE template.**~~ **Resolved 2026-08-24** — analysed read-only. See section 16.
2. **A separate `amazon_catalog_reader` runtime role** on the website database, read-only, provisioned by the user. This has not been created and must not be created by the agent. **Still outstanding.**
3. **Final plan approval.** **Still outstanding.**

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

> **Superseded by section 17.** This section is the Phase 1 checkpoint and is kept for
> history. The feature has since been implemented; see section 17 for what exists now.

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

---

## 16. Phase 1 — template discovery (complete, 2026-08-24)

Performed read-only against `KITCHEN_TOOLS_COOKWARE_SET_SAUTE_FRY_PAN_COOKING_POT_PITCHER.xlsm`. The file was opened through `zipfile` and never written to; its SHA-256 was confirmed unchanged at the end of every test.

### 16.1 It is `.xlsm`, not `.xlsx`

The upload is macro-enabled: `xl/workbook.xml` is declared as `application/vnd.ms-excel.sheet.macroEnabled.main+xml`. There is **no `vbaProject.bin`**, so no macro code actually ships — but the content type must still be preserved, and the accept filter and any filename handling must allow `.xlsm`. Rewriting it as `.xlsx` would change the declared workbook type.

### 16.2 Sheets

Ten sheets, three hidden. Only `Template` is ever written to.

| Sheet | State | Purpose |
| --- | --- | --- |
| `Changes to the template` | visible | Amazon's changelog notice |
| `Instructions` | visible | How to fill and upload |
| `Images` | visible | Image standards; holds a drawing and 22 embedded images |
| `Data Definitions` | visible | Per-field documentation: group, technical name, label, accepted values, example, Required? |
| **`Template`** | visible | **The data sheet — the only write target** |
| `Browse data` | visible | Browse node IDs and their category paths |
| `Conditions List` | **hidden** | Variation-theme condition lists, backs `CONDITION_LIST_*` names |
| `Valid Values` | visible | Permitted enum values per field |
| `Dropdown Lists` | **hidden** | Source ranges for every dropdown, 411 rows × 660 columns |
| `AttributePTDMAP` | **hidden** | Maps each attribute to the product types it applies to |

### 16.3 Row layout of `Template` — the technical header is row 5

`_FilterDatabase` points at row 4, which is a decoy: row 4 holds human labels. The technical names are in **row 5**. Data begins at **row 8**, confirmed independently by the frozen pane (`ySplit=7`).

| Row | Content | Rule |
| --- | --- | --- |
| 1 | `settings=` … `settings10=` in A–J: base64 Amazon machine metadata | Never touch |
| 2 | "Use ENGLISH to fill this template. DO NOT modify or delete the colored header rows." | Never touch |
| 3 | Group bands, sparse: Listing Identity, Variations, Product Identity, Images, Product Details, Offer, Offer (AE), Shipping, Safety & Compliance | Never touch |
| 4 | Display labels — `SKU`, `Product Type`, `Item Name` … (316 cells) | Never touch |
| **5** | **Technical headers** — `contribution_sku#1.value`, `product_type#1.value` … (316 cells) | **Read only; the map key** |
| 6 | Amazon's example row — `ABC123`, `ACCESSORY`, `Adidas Blue Sneakers`, `Sony`, UPC `714532191586` | Never touch |
| 7 | "✅ We've prefilled attributes from your selected Preference Profiles in the rows below. Please do not delete this row." | Never touch |
| 8+ | Data rows (empty in this upload; dimension runs to row 56) | Write blanks only |

Header-row detection must therefore **not** assume row 5 literally. Scan rows 1–20 for the row whose cells look like technical identifiers — high density, `snake_case`, containing `#N` or `.value` — and which contains the SKU attribute. This keys off the SKU column and header density exactly as section 4 requires, never off the subtype column.

### 16.4 Column identity

316 columns, A–LD. The two columns that must never be written:

- **A** `contribution_sku#1.value` — the seller SKU. Read to look up the product; never written. Note this is *not* `item_sku`.
- **B** `product_type#1.value` — **the subtype column.** Read-only, preserved byte-for-byte, never parsed, never validated. The workbook's own dropdowns key off `Template!$B` for every conditional list, which is precisely why the generator must leave it alone.
- **C** `::record_action` — the update/delete action. Never written. This is the column the plan previously called `update_delete`.

Header grammar is `attribute[qualifier=value]…#N.field`, with 305 columns carrying `[marketplace_id=A2VIGQ35RCS4UG]` and 99 carrying `[language_tag=en_AE]`.

### 16.5 Artifacts that must survive

All confirmed preserved by the patching approach:

- 402 data validations on `Template`, of which 187 are `list` dropdowns
- **3 `x14` extension validations** in `extLst` `{CCE6A557-…}` — these are the subtype-conditional dropdowns, with `INDIRECT` formulas reading `B8`. They are the single most fragile artifact in the file and the first thing a rebuild-based library drops.
- 194 conditional formatting blocks, 9 merged ranges, frozen pane at A8
- 4,437 defined names, 3,829 of them ranges
- `xl/drawings/drawing1.xml` and 22 images on the `Images` sheet
- 4,528 shared strings

### 16.6 Coverage against the approved mapping

All 22 approved mapping targets exist. Of the 9 columns Amazon marks hard-`Required`:

| Col | Field | Outcome |
| --- | --- | --- |
| A | SKU | never written, user supplies |
| B | Product Type | never written, subtype rule |
| G | Item Name | filled from `products.name` |
| I | Brand Name | filled, declared constant |
| AD | Product Description | filled from stripped HTML |
| J | Product Id Type | **left blank — no source** |
| AE | Bullet Point | **left blank — the ChatGPT step** |
| HQ | Country of Origin | **left blank — no source** |
| IT | Dangerous Goods Regulations | **left blank — no source, and a legal declaration nobody should infer** |

A further 90 columns are "Conditionally Required", where the condition depends on subtype and is therefore deliberately not evaluated.

`Data Definitions` documents 228 of the 316 columns. The 88 undocumented ones are the `#2`–`#5` repeat slots of multi-value attributes, which Amazon documents only at `#1`.

### 16.7 Consequences for the plan

1. Parse with `zipfile`-level XML access, not ExcelJS. Add no new dependency; Node's `zlib` plus a targeted XML writer is sufficient, and the read path can stay regex-free by using a real XML parser on `sheet5.xml` only.
2. Detect the header row by SKU presence and identifier density, then build the map on normalised header keys.
3. Write via in-place placeholder patching with inline strings, preserving each cell's style.
4. Assert in tests that every OPC part except `sheet5.xml` is byte-identical to the input, and that validation, `x14` validation, conditional formatting, merged range, defined name and sheet counts are unchanged.
5. Accept `.xlsm` as well as `.xlsx`, and preserve the macro-enabled content type on output.
6. Keep `product_type` strictly untouched; the 6 product types present in this file (`COOKING_POT`, `SAUTE_FRY_PAN`, `COOKWARE_SET`, `STOVETOP_KETTLE`, `KITCHEN_TOOLS`, `PITCHER`) are recorded here as observation only and must not appear in code.

---

## 17. Phase 2 — implementation (complete, 2026-08-24)

Implemented locally and verified. Not committed, pushed or deployed.

### 17.1 Files added

Backend service (`backend/src/services/amazonInitialDraft/`):

| File | Role |
| --- | --- |
| `opcPackage.js` | Minimal OPC/zip reader and writer. Streams every untouched entry's original compressed bytes through verbatim, so preservation is structural rather than best effort. |
| `worksheetXml.js` | Surgical SpreadsheetML cell reader/writer. Patches individual `<c>` elements, keeps each cell's style, writes text as inline strings so `sharedStrings.xml` never changes. |
| `amazonTemplateWorkbook.js` | Structure discovery: sheet selection, technical-header row, SKU column, first data row, column table. |
| `unitConversion.js` | Website unit tokens to the template's own unit vocabulary. |
| `specParsers.js` | Deterministic readers for the free-form spec JSON, with explicit rejection of anything ambiguous. |
| `fieldMapping.js` | The single flat header-to-value table plus the never-write guard. |
| `websiteCatalogRepository.js` | The union SKU lookup and the matched / ambiguous / unmatched ruling. |
| `draftGenerator.js` | Orchestration and the cell-write policy. |
| `reportWorkbook.js` | The companion report workbook (ExcelJS — report only, never the Amazon file). |

Also added: `backend/src/db/lifesmileWebsiteDb.js`, `backend/src/controllers/amazonInitialDraftController.js`,
`backend/src/routes/amazonInitialDraft.routes.js`, `src/api/amazonInitialDraft.ts`,
`src/pages/AmazonInitialDraftPage.tsx`.

Modified: `backend/src/app.js` (mount), `src/App.jsx` (admin-only route), `src/components/Layout.jsx`
(nav entry and page title), `src/api/client.js` (`postBinary` now accepts `FormData`).

### 17.2 Findings that changed the plan

1. **The supplied `.xlsm` files contain no `vbaProject.bin`.** All six templates in
   `/tmp/amazon-templates/` are macro-enabled by extension only. The macro part is still
   preserved when present — the synthetic test fixture includes a stored `vbaProject.bin`
   and asserts it survives byte-for-byte — but for these files the artifacts that actually
   need protecting are the 22 embedded images, the drawings, `styles.xml`, and a
   `workbook.xml` holding 4,436 defined names.

2. **Unit vocabularies are marketplace-level, not subtype-level.** The validation
   *formulas* are subtype-conditional, which initially looked like a blocker, but the
   resolved unit lists are identical across all six product types in the file. Units can
   therefore be written without ever reading the subtype.

3. **`material` and `variation_theme` cannot be mapped universally.** Their dropdowns
   resolve to six genuinely different vocabularies; `COOKWARE_SET` does not accept
   "Stainless Steel", which is this catalog's most common value. Both are report-only.

4. **`"None"` is stored as a real guarantee value on 21 products.** Placeholder values
   (`None`, `N/A`, `-`, `nil`, …) are treated as absent for writing but stay visible in the
   report. `"No"` is deliberately not a placeholder: it is a real answer for specs such as
   "Dishwasher Safe".

5. **Piece counts are always bare integers.** Every `pieces` value in the catalog is a
   plain integer, so `parseCount` rejects `"3 pcs"` and similar without losing coverage.

6. **The frozen pane is the reliable first-data-row signal.** Every real template declares
   one (`A8`). The no-pane fallback skips only rows it can identify structurally — a banner
   row, or a row whose SKU cell style differs from the sheet's data rows — and otherwise
   errs towards treating a row as data, because dropping a seller's row silently is worse
   than reporting Amazon's example SKU as unmatched.

7. **A unit is not written next to a number that was kept.** When the seller's own value
   conflicts and is preserved, writing our unit beside it would silently relabel their
   figure, so the unit cell is left blank and reported as
   `paired-value-kept-from-workbook`.

### 17.3 Verification performed

- 146 backend tests for this feature, all passing. Full suite: 993 tests, 988 pass, 5 fail
  — the same five pre-existing unrelated failures (`deriveInvoiceRange`, four
  `zohoRepresentativeItem`).
- Frontend: 207 tests pass. `tsc --noEmit`: 93 pre-existing errors, none in the new files.
  `vite build` succeeds.
- Against the real 316-column template: 43 of 44 parts byte-identical, only
  `xl/worksheets/sheet5.xml` changed. Verified independently with `openpyxl`: 400 data
  validations, 4 `x14` validations, 194 conditional formatting ranges, 726 CF rules, 10
  merged ranges, 4,436 defined names, 3 hidden sheets and the frozen pane all unchanged.
- Structural lint of the patched sheet: well-formed XML, rows and cells in ascending
  order, no duplicate references, no unescaped ampersands, numeric cells numeric.
- 35 image / price / quantity / product_type columns confirmed empty on every data row.

## 18. Phase 3 — product features as bullet points (complete, 2026-08-24)

### 18.1 Where the features actually live

The website has no per-product feature table. The candidates were measured rather than
guessed:

| Candidate | Verdict |
| --- | --- |
| `features` table | Not product content. It is the admin permission registry: `roles`, `dashboard`, `products`, `coupons`, joined from `permissions.feature_id`. |
| `en_specifications` keys such as `Properties`, `Features` | Attribute values, not selling points, and sparse: `properties` on 197 products, `features\t` on 4, `feature` on 1. |
| `product_specifications.long_description` | Prose. Contains a `<ul>` on 266 of 1,063 rows. |
| **`product_specifications.short_description`** | **The feature list.** An ordered `<ul><li>` list on 998 of 1,063 rows (94%). |

`short_description` is therefore the authoritative source. Each `<li>` is one feature and
document order is the authoring order.

### 18.2 Ownership: a variant has no features of its own

Confirmed against the live database:

- 1,063 specification rows across 1,063 distinct products — exactly one row per product.
- `product_specifications.product_id` references `products` only; there is no variant-level
  specification row.
- All 2,181 live variants resolve to their parent's specification row.

So a variant's features are its parent product's features by database design. The catalog
query already joins `product_specifications ps ON ps.product_id = parent.id` in its variant
branch, which is what makes a child row inherit them. A test pins that join, because a
variant-scoped join would silently blank every child row's bullets.

### 18.3 Mapping

The real template exposes five bullet columns, `AE`–`AI`, all one attribute:
`bullet_point[marketplace_id=A2VIGQ35RCS4UG][language_tag=en_AE]#N.value`, normalising to
`bullet_point.value`.

This is the first attribute that fills a *run* of columns rather than one cell, so
`fieldMapping` gained a `LIST_KEYS` set and the generator now pairs entry *n* with column
*n*. Everything else still fills only its first slot.

Behaviour, in order of the requirements:

- Feature *n* goes in bullet column *n*. Order is never re-sorted.
- Only as many columns as the workbook actually has are filled — five in the real template,
  three in the test fixture.
- Text is copied verbatim. Markup is unwrapped (`<strong>`, `<span style>`), entities are
  decoded, `<br>` inside an item becomes a space, and an anchor collapses to its link text
  so the URL does not reach the listing. Nothing is reworded, summarised, merged or split.
- No subtype is read. The mapping is identical for a blank, known or unknown product type.
- Only blank cells are written. A seller's existing bullet is preserved and reported as a
  conflict; an identical one is left byte-for-byte alone.
- Fewer features than columns leaves the spare columns blank, reported as
  `fewer-values-than-columns`.
- No stored features leaves all bullets blank, reported as `no-database-value`.
- More features than columns is the common case: the surplus is listed in a new report sheet
  **Features beyond template** rather than dropped silently.

No length truncation is applied. The template documents no maximum for `bullet_point`, and
truncating would be a form of rewriting; the draft is explicitly labelled as requiring final
Amazon validation.

### 18.4 Clean business-review sample

`~/Desktop/amazon-initial-draft-clean-sample/` was generated from the untouched template.
The simulated upload contains **only** the ten seller SKUs in the SKU column; the template
prefills nothing in its data rows, so there was nothing else to carry over and no product
type was selected. 168 cells populated, 0 conflicts, 49 bullet cells, 88 surplus features
reported.

One point of confusion from the earlier sample is worth recording. Of the values flagged as
synthetic, `My Own Hand-Written Title` and the `999` weight were indeed injected test
content and are now confined to the automated tests. But `Have you lost…`, `Good Health…`
and `Upgrade your…` are genuine Life Smile marketing copy stored in
`product_specifications.long_description` (for `SPP5-L-`, `FLCM-MIX-12-1-GRAY` and
`FLHM-S-3` respectively). They are reproduced verbatim because that is what the website
says.

The sample was checked with `openpyxl`, independently of the code that wrote it: 54 checks
covering package integrity (22 binary parts byte-identical, only `xl/worksheets/sheet5.xml`
changed), unchanged validation and formatting counts (593 validations, 388 conditional
formatting ranges, 1,452 rules, 4,436 defined names, 3 hidden sheets), an upload holding
nothing but SKUs, bullets filling their columns in order with no gaps, each variant matching
its parent's bullets, and image / price / quantity / product type columns empty on every
row.

## 19. Seller SKU matching order (2026-08-24)

`findCatalogItemsBySku` resolves each SKU in this order, and stops at the first step that
gives a single answer:

1. **Exact match.** A SKU whose text equals a catalog `item_code` exactly wins outright,
   even when the catalog also holds the same code in different letter case for another
   product.
2. **Letter case ignored**, after trimming surrounding whitespace, but *only* when that
   resolves to exactly one catalog item. The row is marked `matchKind: 'case-insensitive'`
   and the report shows both the seller's spelling and the catalog code it resolved to.
3. **Ambiguous.** If the exact code appears on several rows, or if ignoring case finds more
   than one item, nothing is written for that row and the candidates are reported. Guessing
   would risk putting one product's content on another product's listing.
4. **Unmatched.** No candidate at all is reported as `not-in-catalog`.

Only letter case and surrounding whitespace are normalised. Internal hyphens, underscores
and spaces are significant, so `LS_POT_24`, `LSPOT24` and `LS POT 24` never reach
`LS-POT-24`. The SKU column is in the never-write set, so the seller's original text always
survives in the workbook regardless of how it matched.

## 20. Provisioning the runtime catalog role

`scripts/provision-amazon-catalog-reader.sh` performs the whole one-off setup. It contains
no secret and is safe to commit. It is deliberately not part of any deployment: a deploy
must never be able to create or alter a database role.

Run it once from a machine that can reach the instance, with master credentials supplied
through the environment:

```bash
PGHOST=lifesmiledbnew.c2omi1mf46ou.eu-central-1.rds.amazonaws.com \
PGUSER=postgres PGPASSWORD='<master password>' \
AWS_PROFILE=abdullah-deploy \
bash scripts/provision-amazon-catalog-reader.sh
```

What it does:

- Generates a 40-character password from `openssl rand`. It is held in a shell variable
  only — never printed, never written to disk, never passed on a command line.
- Creates `amazon_catalog_reader` as `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT` with `CONNECTION LIMIT 5` — the backend pool caps at
  3, leaving headroom for a deploy overlap.
- Sets `default_transaction_read_only=on`, `statement_timeout=30s`,
  `idle_in_transaction_session_timeout=60s` and `lock_timeout=5s` on the role.
- Grants only `CONNECT` on `lifesmiledbnew`, `USAGE` on `public`, and `SELECT` on the five
  tables the repository query actually reads: `products`, `product_variants`,
  `product_specifications`, `product_categories`, `sub_categories`.
- **Revokes nothing.** No table in this database grants `SELECT` to `PUBLIC` (verified), so
  a new role starts with no access and additive grants alone give least privilege. Revoking
  `PUBLIC` privileges on a live website database would risk breaking the website, so the
  script never does it.
- Re-connects *as the new role* and proves the privileges: the approved catalog join
  succeeds; `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE TABLE` and `CREATE ROLE` are
  refused; and `SELECT` is refused on `customers`, `customer_addresses`, `customer_logins`,
  `orders`, `login_credentials`, `tokens`, `carts` and `users`. It aborts before storing
  anything if any check fails.
- Writes the credential to Secrets Manager as
  `lifesmile-website/rds/amazon-catalog-reader`, piped over stdin so it never appears in a
  process list.

Then grant the backend read access to that one secret and nothing else. The backend runs
under the EC2 role `c2-hr-attendance-s3` (instance `i-00f9451138c169214`):

```bash
SECRET_ARN=$(AWS_PROFILE=abdullah-deploy aws secretsmanager describe-secret \
  --region eu-central-1 --secret-id lifesmile-website/rds/amazon-catalog-reader \
  --query ARN --output text)

AWS_PROFILE=abdullah-deploy aws iam put-role-policy \
  --role-name c2-hr-attendance-s3 \
  --policy-name ReadAmazonCatalogReaderSecret \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"secretsmanager:GetSecretValue\"],\"Resource\":\"${SECRET_ARN}\"}]}"
```

Scoped to that single ARN, so it grants no access to the website master credential or to
`hr-attendance/rds/master`.

Finally set `LIFESMILE_WEBSITE_DATABASE_URL` in the backend's environment file on the
instance from the secret's `LIFESMILE_WEBSITE_DATABASE_URL` field. The existing
`DATABASE_URL` for `hr-attendance-production` must be left exactly as it is. The deploy
tarball excludes `.env`, so deployments cannot overwrite or remove it.

TLS needs no extra configuration: `buildPoolConfig` recognises the `*.rds.amazonaws.com`
host and uses the pinned `backend/src/db/certs/eu-central-1-bundle.pem` with
`rejectUnauthorized: true` and hostname verification. `rejectUnauthorized: false` appears
nowhere in the codebase, and any `sslmode` in the URL is ignored rather than allowed to
weaken this.

## 21. Remaining blocker

The `amazon_catalog_reader` role still does not exist on `lifesmiledbnew`, because no
master credential for that instance is available to this workspace: the only channel is the
`cursor_readonly` role (`NOSUPERUSER`, `NOCREATEROLE`), there is no AWS-managed master
secret on the instance, and Secrets Manager holds entries only for
`hr-attendance-production`. Section 20 is the runbook for whoever holds that password.

Until it is run, the code fails closed: without `LIFESMILE_WEBSITE_DATABASE_URL` the API
answers `503 CATALOG_DB_NOT_CONFIGURED` and the admin page shows "Catalog unavailable".
Nothing else in the application is affected.
