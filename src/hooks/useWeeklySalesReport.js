import { useState, useCallback, useEffect, useRef } from 'react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

/**
 * @typedef {Object} ZohoReportRow
 * A normalised Zoho-backed row. Business numbers are authoritative from Zoho.
 * @property {string} sku
 * @property {string} [item_name]  Display name for the ITEM column
 * @property {string} [item_id]   Zoho item id
 * @property {string} family   Zoho **Family** custom field (metadata; always
 *   present in API responses, may be `""`). Not the same as app `report_group` —
 *   use `item_report_groups` for membership; keep `family` for display / future
 *   Excel export columns.
 * @property {string|null} [zoho_representative_item_id]  Chosen Zoho `item_id` for the
 *   family thumbnail (`/api/weekly-reports/zoho-item-images/:id`). Picked by
 *   soup/stock/casserole/saucepan-style scoring; see backend `zohoRepresentativeItem`.
 * @property {string|null} [zoho_representative_sku]  SKU of that representative (optional, display/debug).
 * @property {string|null} [zoho_representative_name]  Zoho item `name` for that pick (optional).
 * @property {number} [zoho_representative_image_selection_version]  Bumps when scoring rules
 *   change; clients can key image caches on this + `item_id`.
 * @property {string} [zoho_representative_reason]  When the backend enables it (e.g. debug), why this item won.
 * @property {number} [zoho_representative_score]  Computed total score (category + size + bonuses) for the pick.
 * @property {number|null} opening_stock  — value (stock qty × Zoho sales `rate`), not units
 * @property {number|null} closing_stock  — value
 * @property {number|null} purchase_amount  — period purchase qty × Zoho item `rate`
 * @property {number|null} returned_to_wholesale  — value (credits) when available, else × cost
 * @property {number|null} sales_amount  — from Zoho Sales by Item, gross of VAT
 */

/**
 * Fetches a Zoho-sourced weekly sales report for a given group + date range.
 *
 * Backend contract: GET /api/weekly-reports/by-group/:group?from_date&to_date
 *   {
 *     report_group, from_date, to_date,
 *     items:  (ZohoReportRow[]) ,
 *     totals: { opening_stock, closing_stock, purchase_amount,
 *               returned_to_wholesale, sales_amount }
 *   }
 *
 * The hook returns:
 *   - items / totals from the response (verbatim, no client-side derivation)
 *   - loading, error
 *   - refetch() for manual reloads
 *   - notConfigured: true when the backend returns 503 ZOHO_NOT_CONFIGURED so
 *     the page can render a clear setup message instead of a generic error.
 * @param {number} [loadToken=0] Incremented by the parent "Load report" action.
 *   Fetches only run when `loadToken` is greater than 0 (or when `refetch` is used after a load).
 */
export function useWeeklySalesReport({ reportGroup, fromDate, toDate, warehouseId = null, excludeWarehouseId = null, loadToken = 0 }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [totals, setTotals] = useState(null)
  const [zoho, setZoho] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [validationErrors, setValidationErrors] = useState([])

  // Tracks the AbortController for the current in-flight request so that a
  // second call (e.g. from React StrictMode double-invoke in development) can
  // cancel the first before starting a new one, avoiding duplicate backend hits.
  const abortRef = useRef(null)

  const fetchReport = useCallback(async () => {
    if (!loadToken) return
    if (!user || !reportGroup || !fromDate || !toDate) {  // warehouseId is optional
      setItems([])
      setTotals(null)
      setZoho(null)
      setLoading(false)
      return
    }

    // Cancel any previous in-flight request before starting a new one.
    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setNotConfigured(false)
    setValidationErrors([])
    try {
      const qsParams = { from_date: fromDate, to_date: toDate }
      if (warehouseId && String(warehouseId).trim() !== '') {
        qsParams.warehouse_id = String(warehouseId).trim()
      }
      if (excludeWarehouseId && String(excludeWarehouseId).trim() !== '') {
        qsParams.exclude_warehouse_id = String(excludeWarehouseId).trim()
      }
      const qs = new URLSearchParams(qsParams).toString()
      const data = await api.get(
        `/api/weekly-reports/by-group/${encodeURIComponent(reportGroup)}?${qs}`,
        { signal: controller.signal }
      )
      setItems(Array.isArray(data?.items) ? data.items : [])
      setTotals(data?.totals || null)
      setZoho(data?.zoho && typeof data.zoho === 'object' ? data.zoho : null)
    } catch (err) {
      // Aborted by a subsequent fetchReport call — let that new call own the
      // loading state; don't touch state here.
      if (err?.name === 'AbortError') return
      const code = err?.body?.code
      if (code === 'ZOHO_NOT_CONFIGURED' || err?.status === 503) {
        setNotConfigured(true)
        setError(err.message || 'Zoho source not configured')
      } else if (code === 'WEBHOOK_INVALID_RESPONSE') {
        setError(err.message || 'Zoho webhook returned an invalid response')
        setValidationErrors(
          Array.isArray(err?.body?.validation_errors) ? err.body.validation_errors : []
        )
      } else {
        setError(err.message || 'Failed to load report')
      }
      setItems([])
      setTotals(null)
      setZoho(null)
    } finally {
      // Only clear the spinner if this invocation still owns the controller.
      // If another fetchReport() started in the meantime it already set
      // abortRef.current to its own controller and called setLoading(true),
      // so we must not override that with setLoading(false).
      if (abortRef.current === controller) {
        setLoading(false)
      }
    }
  // Depend on user.id rather than the full user object so that an identity-
  // preserving setUser() call from AuthContext (auth/me refresh returning the
  // same account with a new object reference) does NOT recreate this callback,
  // which would abort a running Zoho fetch and trigger a redundant re-request.
  // The API token is read from localStorage by api.get(), not from user itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id ?? null, reportGroup, fromDate, toDate, warehouseId ?? null, excludeWarehouseId ?? null, loadToken])

  // When the user resets the parent "load" (e.g. filters changed), clear UI and
  // cancel in-flight fetches so a slow response cannot repopulate stale data.
  useEffect(() => {
    if (loadToken !== 0) return
    if (abortRef.current) {
      try {
        abortRef.current.abort()
      } catch {
        /* ignore */
      }
    }
    setItems([])
    setTotals(null)
    setZoho(null)
    setError(null)
    setNotConfigured(false)
    setValidationErrors([])
    setLoading(false)
  }, [loadToken])

  // Fetch after the user clicks "Load report", and also when active filter inputs
  // change while a report is already loaded (e.g. warehouse list resolves later and
  // excludeWarehouseId becomes available). This fixes first-load stale splits where
  // the initial request runs without the final warehouse/exclusion params.
  const fetchRef = useRef(fetchReport)
  fetchRef.current = fetchReport
  useEffect(() => {
    if (loadToken <= 0) return
    setLoading(true)
    const id = setTimeout(() => fetchRef.current(), 400)
    return () => clearTimeout(id)
  }, [
    loadToken,
    reportGroup,
    fromDate,
    toDate,
    warehouseId ?? null,
    excludeWarehouseId ?? null,
    user?.id ?? null,
  ])

  return {
    items,
    totals,
    zoho,
    loading,
    error,
    notConfigured,
    validationErrors,
    refetch: fetchReport,
  }
}
