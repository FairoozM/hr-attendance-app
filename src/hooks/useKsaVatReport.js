/**
 * Hooks for the KSA VAT Tax report page.
 *
 * useVatCustomers()  – fetches Zoho Books customers once per session
 * useKsaVatReport()  – fetches VAT report data with 400ms debounce, AbortController,
 *                      and the same error-classification pattern as useWeeklySalesReport.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

// ── Customer hook ────────────────────────────────────────────────────────────

/** Module-level session cache so navigating away and back doesn't re-fetch. */
let _cachedContacts = null

/**
 * Fetches the Zoho Books customer list once per browser session.
 *
 * @returns {{ customers: object[], loading: boolean, error: string|null }}
 */
export function useVatCustomers() {
  const [customers, setCustomers] = useState(_cachedContacts || [])
  const [loading, setLoading]     = useState(_cachedContacts === null)
  const [error, setError]         = useState(null)

  useEffect(() => {
    if (_cachedContacts !== null) {
      setCustomers(_cachedContacts)
      setLoading(false)
      return
    }
    let cancelled = false
    api.get('/api/taxation/vat/customers')
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data?.contacts) ? data.contacts : []
        _cachedContacts = list
        setCustomers(list)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load customers')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return { customers, loading, error }
}

// ── VAT report hook ──────────────────────────────────────────────────────────

/**
 * Fetches invoices + credit notes for a date range and optional customer.
 * Mirrors the pattern in useWeeklySalesReport.js exactly:
 *   - useCallback with AbortController in useRef
 *   - 400ms debounce via useEffect
 *   - notConfigured state for 503 ZOHO_NOT_CONFIGURED
 *
 * @param {{ fromDate: string, toDate: string, customerId: string|null }} params
 * @returns {{
 *   invoices:     object[],
 *   creditNotes:  object[],
 *   totals:       object|null,
 *   meta:         object|null,
 *   loading:      boolean,
 *   error:        string|null,
 *   notConfigured: boolean,
 *   refetch:      () => void,
 * }}
 */
export function useKsaVatReport({ fromDate, toDate, customerId = null }) {
  const { user } = useAuth()
  const [invoices, setInvoices]         = useState([])
  const [creditNotes, setCreditNotes]   = useState([])
  const [totals, setTotals]             = useState(null)
  const [meta, setMeta]                 = useState(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState(null)
  const [notConfigured, setNotConfigured] = useState(false)

  const abortRef = useRef(null)

  const fetchReport = useCallback(async () => {
    if (!user || !fromDate || !toDate) {
      setInvoices([])
      setCreditNotes([])
      setTotals(null)
      setMeta(null)
      setLoading(false)
      return
    }

    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setNotConfigured(false)

    try {
      const qsParams = { from_date: fromDate, to_date: toDate }
      if (customerId && String(customerId).trim() !== '') {
        qsParams.customer_id = String(customerId).trim()
      }
      const qs   = new URLSearchParams(qsParams).toString()
      const data = await api.get(`/api/taxation/vat/report?${qs}`, { signal: controller.signal })

      setInvoices(Array.isArray(data?.invoices)     ? data.invoices     : [])
      setCreditNotes(Array.isArray(data?.credit_notes) ? data.credit_notes : [])
      setTotals(data?.totals || null)
      setMeta(data?.meta   || null)
    } catch (err) {
      if (err?.name === 'AbortError') return
      const code = err?.body?.code
      if (code === 'ZOHO_NOT_CONFIGURED' || code === 'ZOHO_SCOPE_MISSING' || err?.status === 503) {
        setNotConfigured(true)
        setError(err?.body?.message || err.message || 'Zoho source not configured')
      } else {
        setError(err.message || 'Failed to load VAT report')
      }
      setInvoices([])
      setCreditNotes([])
      setTotals(null)
      setMeta(null)
    } finally {
      if (abortRef.current === controller) setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id ?? null, fromDate, toDate, customerId ?? null])

  useEffect(() => {
    const id = setTimeout(() => fetchReport(), 400)
    return () => clearTimeout(id)
  }, [fetchReport])

  return {
    invoices,
    creditNotes,
    totals,
    meta,
    loading,
    error,
    notConfigured,
    refetch: fetchReport,
  }
}
