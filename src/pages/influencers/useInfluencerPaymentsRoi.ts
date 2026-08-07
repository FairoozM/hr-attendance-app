import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import {
  fetchInfluencerContractPayments,
  patchInfluencerContractPayment,
  type InfluencerContractPaymentPatch,
} from '../../api/influencerContractPayments'
import { useAuth } from '../../contexts/AuthContext'
import { useInfluencers } from '../../contexts/InfluencersContext'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import type {
  InfluencerContractPayment,
  InfluencerContractPaymentFilterStatus,
  InfluencerPerformanceInput,
  InfluencerPerformanceRecordsResponse,
} from '../../types/influencer'
import {
  buildInfluencerPaymentRows,
  filterPaymentRows,
  readPaymentsInfluencerFilter,
  resolvePaymentsDateRange,
  summarizePaymentsRoi,
  writePaymentsInfluencerFilter,
  type InfluencerContractPaymentRow,
  type InfluencerPaymentsProfitFilter,
  type InfluencerPaymentsRoiDatePreset,
  type InfluencerPaymentsRoiSummary,
} from './influencerPaymentsRoiUtils'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePerformanceRecordsResponse(data: unknown): InfluencerPerformanceRecordsResponse {
  if (!isPlainObject(data)) return { records: [] }
  const records = Array.isArray(data.records) ? data.records : []
  return {
    records: records.filter((row): row is InfluencerPerformanceInput => isPlainObject(row)),
  }
}

export function useInfluencerPaymentsRoi() {
  const { user, loading: authLoading } = useAuth()
  const { influencers, loading: rosterLoading, loadError: rosterError } = useInfluencers()
  const [searchParams, setSearchParams] = useSearchParams()
  const contractFromUrl = searchParams.get('contract') || 'All'
  const influencerId = useMemo(() => readPaymentsInfluencerFilter(searchParams), [searchParams])

  const [records, setRecords] = useState<InfluencerPerformanceInput[] | null>(null)
  const [payments, setPayments] = useState<InfluencerContractPayment[] | null>(null)
  const [performanceError, setPerformanceError] = useState<string | null>(null)
  const [paymentsError, setPaymentsError] = useState<string | null>(null)
  const [performanceLoading, setPerformanceLoading] = useState(true)
  const [paymentsLoading, setPaymentsLoading] = useState(true)
  const [savingContractId, setSavingContractId] = useState<string | null>(null)

  const [datePreset, setDatePreset] = useState<InfluencerPaymentsRoiDatePreset>('all_time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<InfluencerContractPaymentFilterStatus | 'All'>('All')
  const [profitFilter, setProfitFilter] = useState<InfluencerPaymentsProfitFilter>('all')
  const [outstandingOnly, setOutstandingOnly] = useState(false)

  const setInfluencerId = useCallback((next: string) => {
    setSearchParams(writePaymentsInfluencerFilter(searchParams, next), { replace: false })
  }, [searchParams, setSearchParams])

  const loadPerformance = useCallback(async () => {
    if (!user) return
    setPerformanceLoading(true)
    setPerformanceError(null)
    try {
      const data = parsePerformanceRecordsResponse(
        await api.get('/api/influencers/performance-records'),
      )
      setRecords(data.records.map((row) => normalizePerformanceRecord(row)))
    } catch (err: unknown) {
      console.warn('[InfluencerPaymentsRoi] performance load failed', err)
      setRecords([])
      setPerformanceError(err instanceof Error ? err.message : 'Could not load performance data.')
    } finally {
      setPerformanceLoading(false)
    }
  }, [user])

  const loadPayments = useCallback(async () => {
    if (!user) return
    setPaymentsLoading(true)
    setPaymentsError(null)
    try {
      setPayments(await fetchInfluencerContractPayments())
    } catch (err: unknown) {
      console.warn('[InfluencerPaymentsRoi] payments load failed', err)
      setPayments([])
      setPaymentsError(err instanceof Error ? err.message : 'Could not load payment records.')
    } finally {
      setPaymentsLoading(false)
    }
  }, [user])

  const reload = useCallback(async () => {
    await Promise.all([loadPerformance(), loadPayments()])
  }, [loadPerformance, loadPayments])

  useEffect(() => {
    if (authLoading || !user) return
    void loadPerformance()
    void loadPayments()
  }, [authLoading, user, loadPerformance, loadPayments])

  const dateRange = useMemo(
    () => resolvePaymentsDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  )

  const allRows: InfluencerContractPaymentRow[] | null = useMemo(() => {
    if (records === null || payments === null) return null
    return buildInfluencerPaymentRows({
      records,
      roster: influencers,
      payments,
      range: dateRange,
    })
  }, [records, influencers, payments, dateRange])

  const filteredRows = useMemo(() => {
    if (!allRows) return []
    return filterPaymentRows(allRows, {
      influencerId,
      paymentStatus,
      profitFilter,
      outstandingOnly,
      contractId: contractFromUrl,
    }).sort((a, b) => {
      const statusOrder: Record<string, number> = {
        Overdue: 0,
        Pending: 1,
        'Partially Paid': 2,
        Disputed: 3,
        'Not Due': 4,
        Paid: 5,
      }
      const byStatus = (statusOrder[a.effectiveStatus] ?? 6) - (statusOrder[b.effectiveStatus] ?? 6)
      if (byStatus !== 0) return byStatus
      return b.amountOutstanding - a.amountOutstanding
    })
  }, [allRows, influencerId, paymentStatus, profitFilter, outstandingOnly, contractFromUrl])

  const summary: InfluencerPaymentsRoiSummary | null = useMemo(() => {
    if (!allRows) return null
    const scoped = filterPaymentRows(allRows, {
      influencerId,
      paymentStatus: 'All',
      profitFilter,
      outstandingOnly,
      contractId: contractFromUrl,
    })
    return summarizePaymentsRoi(scoped)
  }, [allRows, influencerId, profitFilter, outstandingOnly, contractFromUrl])

  const updatePayment = useCallback(async (
    contractId: string,
    patch: InfluencerContractPaymentPatch,
  ) => {
    setSavingContractId(contractId)
    setPaymentsError(null)
    try {
      const updated = await patchInfluencerContractPayment(contractId, patch)
      setPayments((current) => {
        const list = current ? [...current] : []
        const index = list.findIndex((row) => row.contractId === contractId)
        if (index >= 0) list[index] = updated
        else list.push(updated)
        return list
      })
      return updated
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not save payment update.'
      setPaymentsError(message)
      throw err
    } finally {
      setSavingContractId(null)
    }
  }, [])

  const loading = authLoading || rosterLoading || performanceLoading || paymentsLoading
  const error = rosterError || performanceError || paymentsError

  return {
    loading,
    error,
    savingContractId,
    reload,
    datePreset,
    setDatePreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    influencerId,
    setInfluencerId,
    paymentStatus,
    setPaymentStatus,
    profitFilter,
    setProfitFilter,
    outstandingOnly,
    setOutstandingOnly,
    influencers,
    filteredRows,
    summary,
    updatePayment,
  }
}
