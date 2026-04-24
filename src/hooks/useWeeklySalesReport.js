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
 * @property {number|null} opening_stock  — value (stock qty × Zoho sales `rate`), not units
 * @property {number|null} closing_stock  — value
 * @property {number|null} purchase_amount
 * @property {number|null} returned_to_wholesale  — value (credits) when available, else × cost
 * @property {number|null} sales_amount
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
 */
export function useWeeklySalesReport({ reportGroup, fromDate, toDate, warehouseId = null }) {
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
  }, [user?.id ?? null, reportGroup, fromDate, toDate, warehouseId ?? null])

  // Debounce: wait 400 ms after the last date/group change before firing.
  // React StrictMode double-invoke is absorbed: the first timeout is cleared
  // by the cleanup before it fires, so only one real request starts.
  // We do NOT abort abortRef here — the backend cache deduplicates concurrent
  // requests, so it is harmless for two fetches to race, and aborting here
  // was causing a second setLoading(true) after the first response arrived.
  useEffect(() => {
    const id = setTimeout(() => fetchReport(), 400)
    return () => clearTimeout(id)
  }, [fetchReport])

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
