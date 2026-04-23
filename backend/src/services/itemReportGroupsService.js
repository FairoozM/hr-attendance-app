/**
 * DB layer for the `item_report_groups` table.
 *
 * The Weekly Reports section uses these mappings to decide which Zoho items
 * are eligible for each report. `zohoService` intersects these rows with the
 * Zoho Inventory API (see services/zohoService.js + weeklyReportZohoData.js) —
 * this module only answers "which items belong to group X".
 */

const { query, pool } = require('../db')

const RETURN_COLS = `
  id,
  sku,
  item_id,
  item_name,
  report_group,
  active,
  notes,
  created_at,
  updated_at
`

// ---------------------------------------------------------------------------
// Read APIs used by the Weekly Reports pipeline
// ---------------------------------------------------------------------------

/** Distinct active report_group keys, sorted alphabetically. */
async function listGroupKeys() {
  const { rows } = await query(`
    SELECT DISTINCT report_group
    FROM item_report_groups
    WHERE active = true
    ORDER BY report_group ASC
  `)
  return rows.map((r) => r.report_group)
}

/**
 * All active members of a single report group. Returns one row per item with
 * any combination of identifiers populated; the Zoho service uses sku first
 * (and item_name as a legacy fallback) to match against Zoho rows.
 */
async function listMembersOfGroup(group) {
  const { rows } = await query(
    `
    SELECT id, sku, item_id, item_name, notes
    FROM item_report_groups
    WHERE report_group = $1 AND active = true
    ORDER BY COALESCE(item_name, sku, item_id) ASC
    `,
    [group]
  )
  return rows
}

// ---------------------------------------------------------------------------
// Admin CRUD APIs
// ---------------------------------------------------------------------------

/**
 * List rows with optional filters. Used by the admin UI.
 *
 * @param {object} opts
 * @param {string} [opts.group]         exact report_group filter
 * @param {string} [opts.search]        case-insensitive substring across sku/item_id/item_name/notes
 * @param {boolean|null} [opts.active]  true = active only, false = inactive only, null/undefined = both
 */
async function adminList({ group, search, active } = {}) {
  const wheres = []
  const params = []

  if (group) {
    params.push(group)
    wheres.push(`report_group = $${params.length}`)
  }

  if (active === true || active === false) {
    params.push(active)
    wheres.push(`active = $${params.length}`)
  }

  if (search && String(search).trim()) {
    params.push(`%${String(search).trim().toLowerCase()}%`)
    wheres.push(
      `(LOWER(COALESCE(sku, '')) LIKE $${params.length} ` +
      `OR LOWER(COALESCE(item_id, '')) LIKE $${params.length} ` +
      `OR LOWER(COALESCE(item_name, '')) LIKE $${params.length} ` +
      `OR LOWER(COALESCE(notes, '')) LIKE $${params.length})`
    )
  }

  const sql = `
    SELECT ${RETURN_COLS}
    FROM item_report_groups
    ${wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''}
    ORDER BY report_group ASC, COALESCE(item_name, sku, item_id) ASC
  `

  const { rows } = await query(sql, params)
  return rows
}

/** All distinct report_group keys ever seen, including inactive ones. */
async function adminListAllGroupKeys() {
  const { rows } = await query(`
    SELECT report_group, COUNT(*)::int AS total
    FROM item_report_groups
    GROUP BY report_group
    ORDER BY report_group ASC
  `)
  return rows.map((r) => ({ report_group: r.report_group, total: r.total }))
}

async function findById(id) {
  const { rows } = await query(
    `SELECT ${RETURN_COLS} FROM item_report_groups WHERE id = $1`,
    [id]
  )
  return rows[0] || null
}

/**
 * Insert a new mapping. Caller (controller) is responsible for validating that
 * `report_group` is non-empty and that at least one of sku/item_id/item_name
 * is provided. The DB enforces both via CHECK constraints, but failing in the
 * controller produces friendlier 400s.
 */
async function create({ sku, item_id, item_name, report_group, active, notes }) {
  const { rows } = await query(
    `
    INSERT INTO item_report_groups
      (sku, item_id, item_name, report_group, active, notes)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING ${RETURN_COLS}
    `,
    [
      sku || null,
      item_id || null,
      item_name || null,
      report_group,
      active !== false,
      notes || '',
    ]
  )
  return rows[0]
}

async function update(id, { sku, item_id, item_name, report_group, active, notes }) {
  const { rows } = await query(
    `
    UPDATE item_report_groups
    SET sku          = $1,
        item_id      = $2,
        item_name    = $3,
        report_group = $4,
        active       = $5,
        notes        = $6,
        updated_at   = NOW()
    WHERE id = $7
    RETURNING ${RETURN_COLS}
    `,
    [
      sku || null,
      item_id || null,
      item_name || null,
      report_group,
      active !== false,
      notes || '',
      id,
    ]
  )
  return rows[0] || null
}

async function setActive(id, active) {
  const { rows } = await query(
    `
    UPDATE item_report_groups
    SET active = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING ${RETURN_COLS}
    `,
    [Boolean(active), id]
  )
  return rows[0] || null
}

async function remove(id) {
  const { rowCount } = await query(
    `DELETE FROM item_report_groups WHERE id = $1`,
    [id]
  )
  return rowCount > 0
}

// ---------------------------------------------------------------------------
// Bulk import: matching + transactional upsert
// ---------------------------------------------------------------------------

/**
 * Look up an existing row inside a single report_group using the documented
 * matching priority: SKU → item_id → item_name. The first non-empty
 * identifier wins; subsequent identifiers are ignored for matching purposes
 * but will still be saved as the new values during an upsert.
 *
 * Accepts an optional pg client so the caller can run the lookup inside a
 * transaction (used by `bulkUpsertTx`).
 *
 * Returns the existing row or null.
 */
async function findMatch({ sku, item_id, item_name, report_group }, client) {
  const runner = client || { query: (text, params) => query(text, params) }
  if (sku) {
    const { rows } = await runner.query(
      `SELECT ${RETURN_COLS} FROM item_report_groups
       WHERE report_group = $1 AND LOWER(sku) = LOWER($2)
       LIMIT 1`,
      [report_group, sku]
    )
    if (rows[0]) return rows[0]
  }
  if (item_id) {
    const { rows } = await runner.query(
      `SELECT ${RETURN_COLS} FROM item_report_groups
       WHERE report_group = $1 AND item_id = $2
       LIMIT 1`,
      [report_group, item_id]
    )
    if (rows[0]) return rows[0]
  }
  if (item_name) {
    const { rows } = await runner.query(
      `SELECT ${RETURN_COLS} FROM item_report_groups
       WHERE report_group = $1 AND LOWER(item_name) = LOWER($2)
       LIMIT 1`,
      [report_group, item_name]
    )
    if (rows[0]) return rows[0]
  }
  return null
}

/**
 * Count active rows in each report_group. Used by the controller's dry-run
 * for `mode: replace_group` so the admin can see exactly how many records
 * would be deactivated before they confirm.
 *
 * @param {string[]} groups
 * @returns {Promise<Array<{report_group: string, currently_active: number}>>}
 */
async function countActiveByGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return []
  const { rows } = await query(
    `
    SELECT report_group, COUNT(*)::int AS currently_active
    FROM item_report_groups
    WHERE active = true AND report_group = ANY($1::text[])
    GROUP BY report_group
    `,
    [groups]
  )
  // Always emit a row per requested group, even when count = 0.
  const map = new Map(rows.map((r) => [r.report_group, r.currently_active]))
  return groups.map((g) => ({
    report_group: g,
    currently_active: map.get(g) || 0,
  }))
}

/**
 * Apply a list of pre-validated bulk-import operations inside a single
 * transaction. Either everything is committed or nothing is.
 *
 * When `options.replaceGroups` is provided, every active row in those
 * report_groups is deactivated *first*, inside the same transaction, before
 * the per-row creates/updates run. This implements the "Replace group"
 * import mode: if the CSV later re-asserts a row, the upsert flips it back
 * to active; rows missing from the CSV stay deactivated. The whole batch
 * (deactivate + ops) commits or rolls back together, so partial states are
 * impossible.
 *
 * @param {Array<{action:'create'|'update', value:object, existing_id?:number}>} ops
 * @param {object} [options]
 * @param {string[]} [options.replaceGroups]  groups to deactivate before ops
 * @returns {Promise<{
 *   results: Array<{action, id, row}>,
 *   replace_result: { groups: string[], by_group: Array<{report_group, deactivated}>, deactivated_total: number } | null
 * }>}
 */
async function bulkUpsertTx(ops, options = {}) {
  const replaceGroups = Array.isArray(options.replaceGroups) ? options.replaceGroups : []
  if ((!Array.isArray(ops) || ops.length === 0) && replaceGroups.length === 0) {
    return { results: [], replace_result: null }
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    let replace_result = null
    if (replaceGroups.length > 0) {
      // De-dupe to keep the SQL tidy and the audit log accurate.
      const groups = Array.from(new Set(replaceGroups))
      const byGroup = []
      let deactivated_total = 0
      for (const g of groups) {
        const { rowCount } = await client.query(
          `UPDATE item_report_groups
           SET active = false, updated_at = NOW()
           WHERE report_group = $1 AND active = true`,
          [g]
        )
        byGroup.push({ report_group: g, deactivated: rowCount })
        deactivated_total += rowCount
      }
      replace_result = { groups, by_group: byGroup, deactivated_total }
    }

    const results = []
    for (const op of ops) {
      if (op.action === 'create') {
        const { rows } = await client.query(
          `
          INSERT INTO item_report_groups
            (sku, item_id, item_name, report_group, active, notes)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING ${RETURN_COLS}
          `,
          [
            op.value.sku || null,
            op.value.item_id || null,
            op.value.item_name || null,
            op.value.report_group,
            op.value.active !== false,
            op.value.notes || '',
          ]
        )
        results.push({ action: 'create', id: rows[0].id, row: rows[0] })
      } else if (op.action === 'update') {
        const { rows } = await client.query(
          `
          UPDATE item_report_groups
          SET sku          = $1,
              item_id      = $2,
              item_name    = $3,
              report_group = $4,
              active       = $5,
              notes        = $6,
              updated_at   = NOW()
          WHERE id = $7
          RETURNING ${RETURN_COLS}
          `,
          [
            op.value.sku || null,
            op.value.item_id || null,
            op.value.item_name || null,
            op.value.report_group,
            op.value.active !== false,
            op.value.notes || '',
            op.existing_id,
          ]
        )
        results.push({ action: 'update', id: op.existing_id, row: rows[0] })
      } else {
        throw new Error(`bulkUpsertTx: unknown op.action "${op.action}"`)
      }
    }
    await client.query('COMMIT')
    return { results, replace_result }
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* noop */ }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Bulk import audit log
// ---------------------------------------------------------------------------

const IMPORT_LOG_KEEP = 10

const IMPORT_LOG_COLS = `
  id,
  created_at,
  user_id,
  user_role,
  mode,
  total_rows,
  created_count,
  updated_count,
  invalid_count,
  deactivated_count,
  succeeded,
  error_code,
  notes
`

/**
 * Record one bulk-import attempt and prune the table back to the most recent
 * `IMPORT_LOG_KEEP` rows in the same transaction. We don't keep a long
 * history here — the admin UI only ever shows the last few entries — and a
 * tiny self-pruning table is simpler to reason about than a background job.
 *
 * @param {object} entry
 * @param {number|null} [entry.user_id]
 * @param {string|null} [entry.user_role]
 * @param {string} entry.mode
 * @param {number} [entry.total_rows]
 * @param {number} [entry.created_count]
 * @param {number} [entry.updated_count]
 * @param {number} [entry.invalid_count]
 * @param {number} [entry.deactivated_count]
 * @param {boolean} [entry.succeeded]
 * @param {string|null} [entry.error_code]
 * @param {string|null} [entry.notes]
 */
async function recordImport(entry = {}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `
      INSERT INTO item_report_groups_import_log
        (user_id, user_role, mode,
         total_rows, created_count, updated_count, invalid_count, deactivated_count,
         succeeded, error_code, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING ${IMPORT_LOG_COLS}
      `,
      [
        entry.user_id ?? null,
        entry.user_role ?? null,
        String(entry.mode || 'upsert'),
        Number(entry.total_rows || 0),
        Number(entry.created_count || 0),
        Number(entry.updated_count || 0),
        Number(entry.invalid_count || 0),
        Number(entry.deactivated_count || 0),
        entry.succeeded !== false,
        entry.error_code ?? null,
        entry.notes ?? null,
      ]
    )
    // Keep only the most recent IMPORT_LOG_KEEP entries.
    await client.query(
      `
      DELETE FROM item_report_groups_import_log
      WHERE id NOT IN (
        SELECT id FROM item_report_groups_import_log
        ORDER BY created_at DESC, id DESC
        LIMIT $1
      )
      `,
      [IMPORT_LOG_KEEP]
    )
    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* noop */ }
    throw err
  } finally {
    client.release()
  }
}

/**
 * Fetch the most recent N import-log rows, joined with the users table so the
 * UI can show a friendly username/email per entry without forcing the writer
 * to denormalise. If the join finds nothing (deleted user), we still return
 * the row with user_label = null and let the UI fall back to the role.
 *
 * @param {number} [limit=IMPORT_LOG_KEEP]
 */
async function listRecentImports(limit = IMPORT_LOG_KEEP) {
  const cap = Math.max(1, Math.min(100, Number(limit) || IMPORT_LOG_KEEP))
  const { rows } = await query(
    `
    SELECT l.id,
           l.created_at,
           l.user_id,
           l.user_role,
           l.mode,
           l.total_rows,
           l.created_count,
           l.updated_count,
           l.invalid_count,
           l.deactivated_count,
           l.succeeded,
           l.error_code,
           l.notes,
           u.username    AS user_username
    FROM item_report_groups_import_log l
    LEFT JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT $1
    `,
    [cap]
  )
  return rows.map((r) => ({
    ...r,
    user_label: r.user_username || null,
  }))
}

module.exports = {
  // Used by the Weekly Reports pipeline (zohoService, controller)
  listGroupKeys,
  listMembersOfGroup,
  // Admin CRUD
  adminList,
  adminListAllGroupKeys,
  findById,
  create,
  update,
  setActive,
  remove,
  // Bulk import
  findMatch,
  bulkUpsertTx,
  countActiveByGroups,
  // Bulk import audit log
  recordImport,
  listRecentImports,
  IMPORT_LOG_KEEP,
}
