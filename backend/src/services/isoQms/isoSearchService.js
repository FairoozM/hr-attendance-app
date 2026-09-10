const { query } = require('../../db')
const { filterForAuditor } = require('./isoPermissions')

function snippetAround(text, q, radius = 80) {
  if (!text) return null
  const hay = String(text)
  const needle = String(q || '').split(/\s+/).filter(Boolean)[0] || ''
  if (!needle) return hay.slice(0, radius * 2)
  const idx = hay.toLowerCase().indexOf(needle.toLowerCase())
  if (idx < 0) return hay.slice(0, radius * 2)
  const start = Math.max(0, idx - radius)
  const end = Math.min(hay.length, idx + needle.length + radius)
  return `${start > 0 ? '…' : ''}${hay.slice(start, end)}${end < hay.length ? '…' : ''}`
}

/**
 * PostgreSQL FTS across versions + ILIKE fallback on codes/titles +
 * findings / CA / risks / audits descriptions. Respects auditor filter.
 */
async function searchIso(q, filters = {}, { isAuditor = false } = {}) {
  const term = String(q || '').trim()
  if (!term) return { results: [], total: 0 }

  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200)
  const offset = Math.max(Number(filters.offset) || 0, 0)
  const results = []

  // Documents / versions
  {
    const params = []
    const where = [`d.soft_deleted_at IS NULL`]
    if (isAuditor) {
      const af = filterForAuditor('d', params.length)
      where.push(af.sql)
      params.push(...af.params)
    }
    if (filters.documentType) {
      params.push(filters.documentType)
      where.push(`d.document_type = $${params.length}`)
    }
    if (filters.status) {
      params.push(filters.status)
      where.push(`d.status = $${params.length}`)
    }
    if (filters.includeObsolete !== true && !isAuditor) {
      where.push(`d.status NOT IN ('Obsolete', 'Archived')`)
    }
    if (filters.currentRevisionOnly) {
      where.push(`v.id = d.current_version_id`)
    }
    if (filters.publishToAuditorRoom != null && !isAuditor) {
      params.push(Boolean(filters.publishToAuditorRoom))
      where.push(`d.publish_to_auditor_room = $${params.length}`)
    }

    params.push(term)
    const qIdx = params.length
    params.push(limit)
    params.push(offset)

    const sql = `
      SELECT d.id AS document_id, d.title, d.document_code, d.revision, d.status,
             d.department, d.document_type, d.publish_to_auditor_room,
             v.id AS version_id, v.original_filename, v.extraction_status,
             v.extracted_text,
             ts_rank(v.search_vector, plainto_tsquery('english', $${qIdx})) AS rank,
             CASE
               WHEN v.search_vector @@ plainto_tsquery('english', $${qIdx}) THEN
                 ts_headline('english', coalesce(v.extracted_text, ''), plainto_tsquery('english', $${qIdx}),
                   'MaxWords=25, MinWords=12, MaxFragments=1')
               ELSE NULL
             END AS headline
      FROM iso_documents d
      LEFT JOIN iso_document_versions v ON v.document_id = d.id
        AND (v.id = d.current_version_id OR v.status IN ('Approved','Current','Draft','Under Review'))
      WHERE ${where.join(' AND ')}
        AND (
          v.search_vector @@ plainto_tsquery('english', $${qIdx})
          OR d.title ILIKE '%' || $${qIdx} || '%'
          OR d.document_code ILIKE '%' || $${qIdx} || '%'
          OR d.description ILIKE '%' || $${qIdx} || '%'
          OR v.original_filename ILIKE '%' || $${qIdx} || '%'
        )
      ORDER BY rank DESC NULLS LAST, d.updated_at DESC
      LIMIT $${qIdx + 1} OFFSET $${qIdx + 2}
    `
    const res = await query(sql, params)
    for (const row of res.rows) {
      results.push({
        entityType: 'document',
        id: Number(row.document_id),
        versionId: row.version_id != null ? Number(row.version_id) : null,
        title: row.title,
        documentCode: row.document_code,
        revision: row.revision,
        status: row.status,
        department: row.department,
        documentType: row.document_type,
        publishToAuditorRoom: Boolean(row.publish_to_auditor_room),
        rank: row.rank != null ? Number(row.rank) : 0,
        snippet: row.headline || snippetAround(row.extracted_text, term) || snippetAround(row.title, term),
      })
    }
  }

  if (!isAuditor || filters.includeOperational !== false) {
    // Findings
    if (!isAuditor) {
      const fres = await query(
        `SELECT id, nc_number, description, status, classification
         FROM iso_findings
         WHERE description ILIKE $1 OR nc_number ILIKE $1 OR evidence ILIKE $1
         ORDER BY updated_at DESC LIMIT $2`,
        [`%${term}%`, Math.min(limit, 25)]
      )
      for (const row of fres.rows) {
        results.push({
          entityType: 'finding',
          id: Number(row.id),
          title: row.nc_number || `Finding #${row.id}`,
          status: row.status,
          classification: row.classification,
          rank: 0.4,
          snippet: snippetAround(row.description, term),
        })
      }

      const cares = await query(
        `SELECT id, ca_number, description, status, root_cause, corrective_action_details
         FROM iso_corrective_actions
         WHERE description ILIKE $1 OR ca_number ILIKE $1
            OR root_cause ILIKE $1 OR corrective_action_details ILIKE $1
         ORDER BY updated_at DESC LIMIT $2`,
        [`%${term}%`, Math.min(limit, 25)]
      )
      for (const row of cares.rows) {
        results.push({
          entityType: 'corrective_action',
          id: Number(row.id),
          title: row.ca_number || `CA #${row.id}`,
          status: row.status,
          rank: 0.4,
          snippet: snippetAround(
            [row.description, row.root_cause, row.corrective_action_details].filter(Boolean).join(' — '),
            term
          ),
        })
      }

      const rres = await query(
        `SELECT id, risk_number, description, status FROM iso_risks
         WHERE description ILIKE $1 OR risk_number ILIKE $1
         ORDER BY updated_at DESC LIMIT $2`,
        [`%${term}%`, Math.min(limit, 25)]
      )
      for (const row of rres.rows) {
        results.push({
          entityType: 'risk',
          id: Number(row.id),
          title: row.risk_number || `Risk #${row.id}`,
          status: row.status,
          rank: 0.35,
          snippet: snippetAround(row.description, term),
        })
      }

      const ares = await query(
        `SELECT id, audit_reference, scope, notes, status, audit_type
         FROM iso_audits
         WHERE audit_reference ILIKE $1 OR scope ILIKE $1 OR notes ILIKE $1 OR audit_objective ILIKE $1
         ORDER BY updated_at DESC LIMIT $2`,
        [`%${term}%`, Math.min(limit, 25)]
      )
      for (const row of ares.rows) {
        results.push({
          entityType: 'audit',
          id: Number(row.id),
          title: row.audit_reference || `Audit #${row.id}`,
          status: row.status,
          auditType: row.audit_type,
          rank: 0.35,
          snippet: snippetAround(row.scope || row.notes, term),
        })
      }
    }
  }

  results.sort((a, b) => (b.rank || 0) - (a.rank || 0))
  return { results: results.slice(0, limit), total: results.length, query: term }
}

module.exports = {
  searchIso,
  snippetAround,
}
