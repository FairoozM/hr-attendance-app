const service = require('../services/itemReportGroupsService')
const { parseCsv, indexHeaders, cellOf, CsvParseError } = require('../utils/csv')

const GROUP_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/

function clean(v) {
  return v == null ? '' : String(v).trim()
}

function parseId(req, res) {
  const id = parseInt(req.params.id, 10)
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

/**
 * Tag every write with the acting admin so the log line is grep-friendly when
 * something changes unexpectedly. The auth middleware does not currently load
 * email/username (only userId+role are on `req.user`), so we log what we have.
 */
function actorTag(req) {
  const u = req.user || {}
  const userId = u.userId || 'unknown'
  const role = u.role || 'unknown'
  return `actor=user:${userId}/role:${role}`
}

/** One-line audit record for any write to item_report_groups. */
function logAudit(req, action, payload) {
  const summary = JSON.stringify({
    action,
    ...payload,
  })
  console.info(`[item-report-groups][audit] ${actorTag(req)} ${summary}`)
}

/** Normalise + validate the create/update body. Returns { value, errors }. */
function normalisePayload(body, { partial = false } = {}) {
  const sku        = clean(body.sku)
  const itemId     = clean(body.item_id)
  const itemName   = clean(body.item_name)
  const reportGrp  = clean(body.report_group).toLowerCase()
  const notes      = body.notes == null ? '' : String(body.notes).trim()
  const active     = body.active === undefined ? true : Boolean(body.active)

  const errors = []

  if (!partial || body.report_group !== undefined) {
    if (!reportGrp) {
      errors.push('report_group is required')
    } else if (!GROUP_KEY_RE.test(reportGrp)) {
      errors.push(
        'report_group must be lowercase letters/digits/_/-, 2-64 chars, ' +
        'and start/end with an alphanumeric (e.g. "slow_moving")'
      )
    }
  }

  if (!sku && !itemId && !itemName) {
    errors.push('At least one of sku, item_id, or item_name must be provided')
  }

  if (sku && sku.length > 100) errors.push('sku must be ≤ 100 characters')
  if (itemId && itemId.length > 100) errors.push('item_id must be ≤ 100 characters')
  if (itemName && itemName.length > 255) errors.push('item_name must be ≤ 255 characters')

  return {
    errors,
    value: {
      sku,
      item_id: itemId,
      item_name: itemName,
      report_group: reportGrp,
      active,
      notes,
    },
  }
}

function isUniqueViolation(err) {
  return err && err.code === '23505'
}

/**
 * Build a friendly 409 body for the unique-index violations defined in
 * migration 013. The frontend keys off `code` to render a per-field message.
 */
function duplicateError(value) {
  const key = value.sku ? 'sku' : 'item_name'
  const ident = value.sku || value.item_name || 'this item'
  return {
    error:
      `Duplicate mapping: "${ident}" is already mapped to ` +
      `report_group "${value.report_group}".`,
    code: 'DUPLICATE_MAPPING',
    field: key,
  }
}

async function list(req, res) {
  try {
    const group = clean(req.query.group)
    const search = clean(req.query.search)
    let active
    if (req.query.active === 'true') active = true
    else if (req.query.active === 'false') active = false
    const rows = await service.adminList({ group, search, active })
    res.json(rows)
  } catch (err) {
    console.error('[item-report-groups] list error:', err)
    res.status(500).json({ error: 'Failed to load item report groups' })
  }
}

async function listGroupKeys(_req, res) {
  try {
    const groups = await service.adminListAllGroupKeys()
    res.json({ groups })
  } catch (err) {
    console.error('[item-report-groups] listGroupKeys error:', err)
    res.status(500).json({ error: 'Failed to load report group keys' })
  }
}

async function getOne(req, res) {
  try {
    const id = parseId(req, res)
    if (id == null) return
    const row = await service.findById(id)
    if (!row) return res.status(404).json({ error: 'Mapping not found' })
    res.json(row)
  } catch (err) {
    console.error('[item-report-groups] get error:', err)
    res.status(500).json({ error: 'Failed to load mapping' })
  }
}

async function create(req, res) {
  let value
  try {
    const parsed = normalisePayload(req.body)
    if (parsed.errors.length) {
      return res.status(400).json({ error: parsed.errors.join('; ') })
    }
    value = parsed.value
    const row = await service.create(value)
    logAudit(req, 'create', {
      id: row.id,
      report_group: row.report_group,
      sku: row.sku,
      item_name: row.item_name,
      item_id: row.item_id,
      active: row.active,
    })
    res.status(201).json(row)
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json(duplicateError(value || req.body || {}))
    }
    console.error('[item-report-groups] create error:', err)
    res.status(500).json({ error: 'Failed to create mapping' })
  }
}

async function update(req, res) {
  let value
  try {
    const id = parseId(req, res)
    if (id == null) return
    const existing = await service.findById(id)
    if (!existing) return res.status(404).json({ error: 'Mapping not found' })
    const parsed = normalisePayload(req.body)
    if (parsed.errors.length) {
      return res.status(400).json({ error: parsed.errors.join('; ') })
    }
    value = parsed.value
    const row = await service.update(id, value)
    logAudit(req, 'update', {
      id: row.id,
      report_group: row.report_group,
      sku: row.sku,
      item_name: row.item_name,
      item_id: row.item_id,
      active: row.active,
      previous: {
        report_group: existing.report_group,
        sku: existing.sku,
        item_name: existing.item_name,
        item_id: existing.item_id,
        active: existing.active,
      },
    })
    res.json(row)
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json(duplicateError(value || req.body || {}))
    }
    console.error('[item-report-groups] update error:', err)
    res.status(500).json({ error: 'Failed to update mapping' })
  }
}

async function setActive(req, res) {
  try {
    const id = parseId(req, res)
    if (id == null) return
    if (typeof req.body?.active !== 'boolean') {
      return res.status(400).json({ error: 'Body must include { active: boolean }' })
    }
    const row = await service.setActive(id, req.body.active)
    if (!row) return res.status(404).json({ error: 'Mapping not found' })
    logAudit(req, row.active ? 'activate' : 'deactivate', {
      id: row.id,
      report_group: row.report_group,
      sku: row.sku,
      item_name: row.item_name,
    })
    res.json(row)
  } catch (err) {
    console.error('[item-report-groups] setActive error:', err)
    res.status(500).json({ error: 'Failed to update mapping status' })
  }
}

async function remove(req, res) {
  try {
    const id = parseId(req, res)
    if (id == null) return
    const existing = await service.findById(id)
    if (!existing) return res.status(404).json({ error: 'Mapping not found' })
    const ok = await service.remove(id)
    if (!ok) return res.status(404).json({ error: 'Mapping not found' })
    logAudit(req, 'delete', {
      id,
      report_group: existing.report_group,
      sku: existing.sku,
      item_name: existing.item_name,
      item_id: existing.item_id,
    })
    res.status(204).send()
  } catch (err) {
    console.error('[item-report-groups] remove error:', err)
    res.status(500).json({ error: 'Failed to delete mapping' })
  }
}

// ---------------------------------------------------------------------------
// Bulk import (admin productivity feature — additive, does not replace CRUD)
// ---------------------------------------------------------------------------

const REQUIRED_HEADERS = ['report_group']
const KNOWN_HEADERS    = ['report_group', 'sku', 'item_id', 'item_name', 'active', 'notes']
const MAX_IMPORT_ROWS  = 5000

const TRUE_VALUES  = new Set(['true', 't', 'yes', 'y', '1'])
const FALSE_VALUES = new Set(['false', 'f', 'no', 'n', '0'])

function parseActiveCell(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase()
  if (s === '') return { value: true,  error: null }
  if (TRUE_VALUES.has(s))  return { value: true,  error: null }
  if (FALSE_VALUES.has(s)) return { value: false, error: null }
  return {
    value: true,
    error: `"active" must be true/false, yes/no, or 1/0 (got ${JSON.stringify(raw)})`,
  }
}

/**
 * Build a structured plan from the parsed CSV — every row is classified
 * as create / update / invalid, with normalised values and a list of errors
 * if any. Returns the plan + summary; the caller decides whether to commit
 * (real import) or just return it (dry run).
 *
 * Within a single CSV the planner also detects in-payload duplicates: if two
 * rows resolve to the same identifier in the same report_group, the second
 * one is flagged as invalid with a clear reason. This prevents surprises like
 * the user editing the same SKU twice in different rows.
 */
/**
 * Bulk-import modes:
 *   - 'upsert'        (default) match-or-create per row; nothing else changes
 *   - 'replace_group' deactivate every active row in each report_group
 *                     touched by the CSV, then upsert the CSV rows. Rows
 *                     missing from the CSV stay deactivated. Affects only
 *                     the groups present in the uploaded file.
 */
const IMPORT_MODES = new Set(['upsert', 'replace_group'])

function parseImportMode(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase()
  if (v === '' || v === 'upsert') return 'upsert'
  if (v === 'replace_group') return 'replace_group'
  const e = new Error(`Unknown import mode "${raw}". Allowed: ${Array.from(IMPORT_MODES).join(', ')}.`)
  e.code = 'INVALID_IMPORT_MODE'
  throw e
}

async function planImport(csvText) {
  const parsed = parseCsv(csvText)
  if (parsed.rows.length === 0) {
    const e = new Error('CSV has a header but no data rows')
    e.code = 'CSV_NO_ROWS'
    throw e
  }
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    const e = new Error(
      `CSV has ${parsed.rows.length} rows; the importer accepts at most ${MAX_IMPORT_ROWS}.`
    )
    e.code = 'CSV_TOO_LARGE'
    throw e
  }
  const headerIdx = indexHeaders(parsed.headers)
  const missing = REQUIRED_HEADERS.filter((h) => !headerIdx.has(h))
  if (missing.length) {
    const e = new Error(
      `CSV is missing required header(s): ${missing.join(', ')}. ` +
      `Expected at least: ${REQUIRED_HEADERS.join(', ')}. ` +
      `Optional: ${KNOWN_HEADERS.filter((h) => !REQUIRED_HEADERS.includes(h)).join(', ')}.`
    )
    e.code = 'CSV_MISSING_HEADERS'
    throw e
  }
  const unknown = parsed.headers.filter((h) => h && !KNOWN_HEADERS.includes(h.toLowerCase()))

  // First pass: per-row normalisation + standalone validation.
  const planned = []
  for (let i = 0; i < parsed.rows.length; i++) {
    const raw = parsed.rows[i]
    const rowNumber = i + 2 // header is line 1
    const errors = []

    if (raw._extraCells) {
      errors.push(`Row has ${raw._extraCells} extra cell(s) beyond the header row`)
    }

    const reportGroup = cellOf(raw, headerIdx, 'report_group').toLowerCase()
    const sku         = cellOf(raw, headerIdx, 'sku')
    const itemId      = cellOf(raw, headerIdx, 'item_id')
    const itemName    = cellOf(raw, headerIdx, 'item_name')
    const notes       = cellOf(raw, headerIdx, 'notes')
    const activeRaw   = cellOf(raw, headerIdx, 'active')

    if (!reportGroup) errors.push('report_group is required')
    else if (!GROUP_KEY_RE.test(reportGroup)) {
      errors.push(
        'report_group must be lowercase letters/digits/_/-, 2-64 chars, ' +
        'and start/end with an alphanumeric (e.g. "slow_moving")'
      )
    }
    if (!sku && !itemId && !itemName) {
      errors.push('At least one of sku, item_id, or item_name is required')
    }
    if (sku.length > 100) errors.push('sku must be ≤ 100 characters')
    if (itemId.length > 100) errors.push('item_id must be ≤ 100 characters')
    if (itemName.length > 255) errors.push('item_name must be ≤ 255 characters')

    const activeParsed = parseActiveCell(activeRaw)
    if (activeParsed.error) errors.push(activeParsed.error)

    const normalized = {
      report_group: reportGroup,
      sku, item_id: itemId, item_name: itemName,
      active: activeParsed.value,
      notes,
    }

    if (errors.length) {
      planned.push({
        row_number: rowNumber,
        action: 'invalid',
        normalized,
        errors,
      })
      continue
    }

    planned.push({
      row_number: rowNumber,
      action: 'pending', // resolved to 'create' or 'update' in pass 2
      normalized,
    })
  }

  // In-payload duplicate detection. Two rows in the same uploaded CSV are
  // duplicates when they would resolve to the *same* `item_report_groups`
  // record per the upsert matching priority — sku → item_id → item_name,
  // scoped to report_group. We mark every duplicate after the first as
  // `invalid` (so the dry-run banner counts them and the row-level table
  // shows them in red), while keeping the first occurrence valid.
  const seen = new Map() // key -> { row_number, identifier_field }
  for (const p of planned) {
    if (p.action !== 'pending') continue
    const v = p.normalized
    let identKey = ''
    let identField = ''
    if (v.sku) {
      identKey   = `sku:${v.sku.toLowerCase()}`
      identField = 'sku'
    } else if (v.item_id) {
      identKey   = `id:${v.item_id}`
      identField = 'item_id'
    } else {
      identKey   = `name:${v.item_name.toLowerCase()}`
      identField = 'item_name'
    }
    const key = `${v.report_group}|${identKey}`
    const first = seen.get(key)
    if (first) {
      p.action = 'invalid'
      p.duplicate_of_row = first.row_number
      p.duplicate_field  = first.identifier_field
      p.errors = [
        `Duplicate row in file (same ${first.identifier_field} + report_group)`,
        `First occurrence at row ${first.row_number}`,
      ]
    } else {
      seen.set(key, { row_number: p.row_number, identifier_field: identField })
    }
  }

  // Second pass: resolve create vs update against the live table.
  for (const p of planned) {
    if (p.action !== 'pending') continue
    try {
      const existing = await service.findMatch(p.normalized)
      if (existing) {
        p.action = 'update'
        p.existing_id = existing.id
        p.existing = {
          report_group: existing.report_group,
          sku: existing.sku, item_id: existing.item_id, item_name: existing.item_name,
          active: existing.active, notes: existing.notes,
        }
      } else {
        p.action = 'create'
      }
    } catch (err) {
      p.action = 'invalid'
      p.errors = [`Lookup failed: ${err.message || 'database error'}`]
    }
  }

  const summary = {
    total_rows:    planned.length,
    to_create:     planned.filter((p) => p.action === 'create').length,
    to_update:     planned.filter((p) => p.action === 'update').length,
    invalid:       planned.filter((p) => p.action === 'invalid').length,
    duplicate_in_csv: planned.filter((p) => p.action === 'invalid' && p.duplicate_of_row != null).length,
    unknown_headers: unknown,
  }

  return { headers: parsed.headers, rows: planned, summary }
}

function planErrorStatus(code) {
  switch (code) {
    case 'CSV_PARSE_ERROR':
    case 'CSV_NO_ROWS':
    case 'CSV_MISSING_HEADERS':
    case 'CSV_TOO_LARGE':
    case 'INVALID_IMPORT_MODE':
      return 400
    default:
      return 500
  }
}

/**
 * Distinct report_groups touched by validated rows in the plan. Used by
 * `replace_group` mode to scope the deactivation step. Invalid rows are
 * intentionally excluded — we never deactivate a group based on a row that
 * the planner already rejected.
 */
function affectedGroupsFromPlan(plan) {
  const set = new Set()
  for (const row of plan.rows) {
    if (row.action === 'create' || row.action === 'update') {
      const g = row.normalized?.report_group
      if (g) set.add(g)
    }
  }
  return Array.from(set).sort()
}

/**
 * Build the dry-run preview block for `replace_group` mode. Tells the admin
 * exactly how many rows are currently active in each group that the CSV
 * touches, so they can confirm the destructive deactivation in good faith.
 */
async function buildReplacePreview(plan) {
  const groups = affectedGroupsFromPlan(plan)
  const byGroup = await service.countActiveByGroups(groups)
  const inCsvByGroup = new Map(byGroup.map((g) => [g.report_group, 0]))
  for (const row of plan.rows) {
    if (row.action === 'create' || row.action === 'update') {
      const k = row.normalized.report_group
      inCsvByGroup.set(k, (inCsvByGroup.get(k) || 0) + 1)
    }
  }
  return {
    groups,
    by_group: byGroup.map((g) => ({
      ...g,
      in_csv: inCsvByGroup.get(g.report_group) || 0,
    })),
    currently_active_total: byGroup.reduce((sum, g) => sum + g.currently_active, 0),
  }
}

function readCsvFromBody(req, res) {
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : ''
  if (!csv.trim()) {
    res.status(400).json({
      error: 'Body must include { "csv": "<file contents>" } as JSON.',
      code: 'CSV_BODY_MISSING',
    })
    return null
  }
  return csv
}

async function bulkImportDryRun(req, res) {
  const csv = readCsvFromBody(req, res)
  if (csv == null) return
  try {
    const importMode = parseImportMode(req.body?.mode)
    const plan = await planImport(csv)
    const out = { mode: 'dry_run', import_mode: importMode, ...plan }
    if (importMode === 'replace_group') {
      out.replace_preview = await buildReplacePreview(plan)
    }
    res.json(out)
  } catch (err) {
    if (err instanceof CsvParseError || err.code) {
      return res.status(planErrorStatus(err.code)).json({
        error: err.message,
        code: err.code || 'CSV_PARSE_ERROR',
      })
    }
    console.error('[item-report-groups] bulkImportDryRun error:', err)
    res.status(500).json({ error: 'Bulk import dry-run failed' })
  }
}

async function bulkImport(req, res) {
  const csv = readCsvFromBody(req, res)
  if (csv == null) return

  let importMode
  try {
    importMode = parseImportMode(req.body?.mode)
  } catch (err) {
    return res.status(planErrorStatus(err.code)).json({ error: err.message, code: err.code })
  }

  let plan
  try {
    plan = await planImport(csv)
  } catch (err) {
    if (err instanceof CsvParseError || err.code) {
      return res.status(planErrorStatus(err.code)).json({
        error: err.message,
        code: err.code || 'CSV_PARSE_ERROR',
      })
    }
    console.error('[item-report-groups] bulkImport plan error:', err)
    return res.status(500).json({ error: 'Bulk import failed during planning' })
  }

  if (plan.summary.invalid > 0) {
    return res.status(422).json({
      error:
        `Refusing to import: ${plan.summary.invalid} of ${plan.summary.total_rows} ` +
        `row(s) failed validation. Run a dry-run, fix the errors, then import again.`,
      code: 'IMPORT_HAS_INVALID_ROWS',
      mode: 'import',
      import_mode: importMode,
      ...plan,
    })
  }

  // Safety guard: 'replace_group' on an empty CSV would deactivate every
  // active row in the affected group(s) without re-applying anything. We
  // refuse rather than ship a footgun. The admin can always use the regular
  // CRUD flow to deactivate rows individually.
  const groupsToReplace = importMode === 'replace_group' ? affectedGroupsFromPlan(plan) : []
  if (importMode === 'replace_group' && groupsToReplace.length === 0) {
    return res.status(400).json({
      error: 'Refusing replace_group import with no valid CSV rows to apply.',
      code: 'REPLACE_GROUP_EMPTY_CSV',
    })
  }

  const ops = plan.rows.map((p) => ({
    action: p.action, // 'create' or 'update'
    value: p.normalized,
    existing_id: p.existing_id,
  }))

  try {
    const { results, replace_result } = await service.bulkUpsertTx(ops, {
      replaceGroups: groupsToReplace,
    })
    plan.rows.forEach((p, i) => {
      const r = results[i]
      if (r) {
        p.id = r.id
        p.result_action = r.action
      }
    })
    logAudit(req, 'bulk_import', {
      mode: importMode,
      total_rows: plan.summary.total_rows,
      created: plan.summary.to_create,
      updated: plan.summary.to_update,
      replace_groups: groupsToReplace,
      deactivated: replace_result?.deactivated_total || 0,
    })
    // Persist a tiny audit row so the admin UI can show "last 10 imports".
    // Best-effort: if logging fails we still surface the successful import.
    try {
      await service.recordImport({
        user_id:           req.user?.userId ?? null,
        user_role:         req.user?.role ?? null,
        mode:              importMode,
        total_rows:        plan.summary.total_rows,
        created_count:     plan.summary.to_create,
        updated_count:     plan.summary.to_update,
        invalid_count:     plan.summary.invalid,
        deactivated_count: replace_result?.deactivated_total || 0,
        succeeded:         true,
        error_code:        null,
      })
    } catch (logErr) {
      console.error('[item-report-groups] recordImport failed (non-fatal):', logErr)
    }
    res.json({
      mode: 'import',
      import_mode: importMode,
      committed: true,
      ...plan,
      ...(replace_result ? { replace_result } : {}),
    })
  } catch (err) {
    console.error('[item-report-groups] bulkImport commit error:', err)
    // Record the failed attempt so the admin can see it in the log alongside
    // successes. If even the log write fails, we still return the original
    // commit error to the caller.
    try {
      await service.recordImport({
        user_id:       req.user?.userId ?? null,
        user_role:     req.user?.role ?? null,
        mode:          importMode,
        total_rows:    plan.summary.total_rows,
        created_count: 0,
        updated_count: 0,
        invalid_count: plan.summary.invalid,
        succeeded:     false,
        error_code:    err && err.code === '23505' ? 'IMPORT_UNIQUE_VIOLATION' : 'IMPORT_COMMIT_ERROR',
        notes:         (err && (err.detail || err.message)) ? String(err.detail || err.message).slice(0, 500) : null,
      })
    } catch (logErr) {
      console.error('[item-report-groups] recordImport (failure path) failed:', logErr)
    }
    if (err && err.code === '23505') {
      return res.status(409).json({
        error:
          'Bulk import failed due to a unique-constraint violation. The whole ' +
          'import was rolled back. Re-run dry-run to see which row caused it.',
        code: 'IMPORT_UNIQUE_VIOLATION',
        detail: err.detail || err.message,
      })
    }
    res.status(500).json({
      error: 'Bulk import failed; the whole transaction was rolled back.',
      detail: err.message,
    })
  }
}

/**
 * GET /api/item-report-groups/import/log
 *
 * Returns the most recent bulk-import attempts (success and failure). The
 * service caps storage at the last 10 rows, so this endpoint is bounded by
 * design and safe to call frequently from the admin UI.
 */
async function listImportLog(req, res) {
  try {
    const limit = parseInt(req.query.limit, 10)
    const rows = await service.listRecentImports(
      Number.isFinite(limit) && limit > 0 ? limit : service.IMPORT_LOG_KEEP
    )
    res.json({ entries: rows, kept: service.IMPORT_LOG_KEEP })
  } catch (err) {
    console.error('[item-report-groups] listImportLog error:', err)
    res.status(500).json({ error: 'Failed to load import log' })
  }
}

module.exports = {
  list,
  listGroupKeys,
  getOne,
  create,
  update,
  setActive,
  remove,
  // Bulk import endpoints (admin productivity)
  bulkImportDryRun,
  bulkImport,
  listImportLog,
  // Exported for unit testing.
  _internals: {
    normalisePayload,
    duplicateError,
    GROUP_KEY_RE,
    planImport,
    parseActiveCell,
    parseImportMode,
    affectedGroupsFromPlan,
    buildReplacePreview,
    IMPORT_MODES,
  },
}
