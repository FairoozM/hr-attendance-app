import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'

/**
 * Admin hook for managing the `item_report_groups` table.
 *
 * Backend contract:
 *   GET    /api/item-report-groups[?group=&search=&active=]   list rows
 *   GET    /api/item-report-groups/groups                     [{ report_group, total }, ...]
 *   POST   /api/item-report-groups                            create
 *   PUT    /api/item-report-groups/:id                        update
 *   PATCH  /api/item-report-groups/:id/active                 toggle active
 *   DELETE /api/item-report-groups/:id                        delete
 *
 * The hook keeps the row list in local state and exposes an imperative API
 * that the page calls from its modals.
 */

const EMPTY_FILTERS = { group: '', search: '', active: 'all' }

function buildQuery(filters) {
  const qs = new URLSearchParams()
  if (filters.group) qs.set('group', filters.group)
  if (filters.search) qs.set('search', filters.search)
  if (filters.active === 'active') qs.set('active', 'true')
  if (filters.active === 'inactive') qs.set('active', 'false')
  const s = qs.toString()
  return s ? `?${s}` : ''
}

export function useItemReportGroups(initialFilters = EMPTY_FILTERS) {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...initialFilters })
  const [items, setItems] = useState([])
  const [groupKeys, setGroupKeys] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.get(`/api/item-report-groups${buildQuery(filters)}`)
      setItems(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Failed to load item report groups')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [filters])

  const fetchGroupKeys = useCallback(async () => {
    try {
      const data = await api.get('/api/item-report-groups/groups')
      setGroupKeys(Array.isArray(data?.groups) ? data.groups : [])
    } catch {
      // Non-fatal; the filter dropdown just stays minimal.
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { fetchGroupKeys() }, [fetchGroupKeys])

  const createItem = useCallback(async (payload) => {
    const created = await api.post('/api/item-report-groups', payload)
    setItems((prev) => [created, ...prev])
    fetchGroupKeys()
    return created
  }, [fetchGroupKeys])

  const updateItem = useCallback(async (id, payload) => {
    const updated = await api.put(`/api/item-report-groups/${id}`, payload)
    setItems((prev) => prev.map((row) => (row.id === id ? updated : row)))
    fetchGroupKeys()
    return updated
  }, [fetchGroupKeys])

  const toggleActive = useCallback(async (id, active) => {
    const updated = await api.patch(`/api/item-report-groups/${id}/active`, { active })
    setItems((prev) => prev.map((row) => (row.id === id ? updated : row)))
    return updated
  }, [])

  const deleteItem = useCallback(async (id) => {
    await api.delete(`/api/item-report-groups/${id}`)
    setItems((prev) => prev.filter((row) => row.id !== id))
    fetchGroupKeys()
  }, [fetchGroupKeys])

  /**
   * Validate a CSV without saving. Returns the planner output verbatim so the
   * page can render row-level previews. The caller should then call
   * `bulkImport` to commit if `summary.invalid === 0`.
   *
   * @param {string} csv  the CSV file contents
   * @param {object} [opts]
   * @param {'upsert'|'replace_group'} [opts.mode='upsert']
   *   `replace_group` instructs the backend to deactivate every active row in
   *   each report_group present in the CSV before applying the upsert. The
   *   dry-run response then includes a `replace_preview` block showing the
   *   impact per group.
   */
  const bulkImportDryRun = useCallback(async (csv, opts = {}) => {
    return api.post('/api/item-report-groups/import/dry-run', {
      csv,
      mode: opts.mode || 'upsert',
    })
  }, [])

  /**
   * Commit the bulk import. The whole batch is transactional on the backend —
   * either everything succeeds or nothing changes. After a successful import
   * we refresh the local list + group keys.
   *
   * @param {string} csv
   * @param {object} [opts]
   * @param {'upsert'|'replace_group'} [opts.mode='upsert']
   */
  const bulkImport = useCallback(async (csv, opts = {}) => {
    const result = await api.post('/api/item-report-groups/import', {
      csv,
      mode: opts.mode || 'upsert',
    })
    await fetchAll()
    fetchGroupKeys()
    return result
  }, [fetchAll, fetchGroupKeys])

  /**
   * Fetch the recent bulk-import audit log. The backend caps storage at the
   * last 10 attempts (success and failure both), so this is bounded and safe
   * to call frequently from the admin sidebar.
   */
  const fetchImportLog = useCallback(async () => {
    return api.get('/api/item-report-groups/import/log')
  }, [])

  const stats = useMemo(() => {
    const byGroup = new Map()
    for (const r of items) {
      const k = r.report_group
      const cur = byGroup.get(k) || { total: 0, active: 0 }
      cur.total += 1
      if (r.active) cur.active += 1
      byGroup.set(k, cur)
    }
    return {
      total: items.length,
      active: items.filter((r) => r.active).length,
      byGroup: Array.from(byGroup, ([report_group, v]) => ({ report_group, ...v })),
    }
  }, [items])

  return {
    items,
    groupKeys,
    stats,
    filters,
    setFilters,
    loading,
    error,
    createItem,
    updateItem,
    toggleActive,
    deleteItem,
    bulkImportDryRun,
    bulkImport,
    fetchImportLog,
    refetch: fetchAll,
  }
}
