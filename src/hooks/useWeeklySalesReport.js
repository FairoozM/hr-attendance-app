import { useState, useCallback, useEffect } from 'react'
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
 * @property {number} opening_stock
 * @property {number} purchases
 * @property {number} returned_to_wholesale
 * @property {number} closing_stock
 * @property {number} sold
 */

/**
 * Fetches a Zoho-sourced weekly sales report for a given group + date range.
 *
 * Backend contract: GET /api/weekly-reports/by-group/:group?from_date&to_date
 *   {
 *     report_group, from_date, to_date,
 *     items:  (ZohoReportRow[]) ,
 *     totals: { opening_stock, purchases, returned_to_wholesale,
 *               closing_stock, sold }
 *   }
 *
 * The hook returns:
 *   - items / totals from the response (verbatim, no client-side derivation)
 *   - loading, error
 *   - refetch() for manual reloads
 *   - notConfigured: true when the backend returns 503 ZOHO_NOT_CONFIGURED so
 *     the page can render a clear setup message instead of a generic error.
 */
export function useWeeklySalesReport({ reportGroup, fromDate, toDate }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [totals, setTotals] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [validationErrors, setValidationErrors] = useState([])

  const fetchReport = useCallback(async () => {
    if (!user || !reportGroup || !fromDate || !toDate) {
      setItems([])
      setTotals(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    setNotConfigured(false)
    setValidationErrors([])
    try {
      const qs = new URLSearchParams({ from_date: fromDate, to_date: toDate }).toString()
      const data = await api.get(
        `/api/weekly-reports/by-group/${encodeURIComponent(reportGroup)}?${qs}`
      )
      setItems(Array.isArray(data?.items) ? data.items : [])
      setTotals(data?.totals || null)
    } catch (err) {
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
    } finally {
      setLoading(false)
    }
  }, [user, reportGroup, fromDate, toDate])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  return {
    items,
    totals,
    loading,
    error,
    notConfigured,
    validationErrors,
    refetch: fetchReport,
  }
}
