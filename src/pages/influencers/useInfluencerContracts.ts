import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { fetchInfluencerContractPayments } from '../../api/influencerContractPayments'
import { useAuth } from '../../contexts/AuthContext'
import { useInfluencers } from '../../contexts/InfluencersContext'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import type {
  InfluencerContractPayment,
  InfluencerPerformanceInput,
  InfluencerPerformanceRecordsResponse,
} from '../../types/influencer'
import {
  buildInfluencerContractListRows,
  contractsFiltersToSearchParams,
  filterContractListRows,
  paginateContractListRows,
  readContractsFiltersFromSearchParams,
  resolveContractsDateRange,
  sortContractListRows,
  type InfluencerContractListRow,
  type InfluencerContractsFilters,
} from './influencerContractsUtils'
import { resolveInfluencerById } from './influencerProfileUtils'

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

export function useInfluencerContracts() {
  const { user, loading: authLoading } = useAuth()
  const { influencers, loading: rosterLoading, loadError: rosterError } = useInfluencers()
  const [searchParams, setSearchParams] = useSearchParams()

  const [records, setRecords] = useState<InfluencerPerformanceInput[] | null>(null)
  const [payments, setPayments] = useState<InfluencerContractPayment[] | null>(null)
  const [performanceError, setPerformanceError] = useState<string | null>(null)
  const [paymentsError, setPaymentsError] = useState<string | null>(null)
  const [performanceLoading, setPerformanceLoading] = useState(true)
  const [paymentsLoading, setPaymentsLoading] = useState(true)

  const filters = useMemo(() => readContractsFiltersFromSearchParams(searchParams), [searchParams])

  const updateFilters = useCallback((patch: Partial<InfluencerContractsFilters>) => {
    const next = { ...readContractsFiltersFromSearchParams(searchParams), ...patch }
    if (patch.influencerId !== undefined
      || patch.contractStatus !== undefined
      || patch.campaignQuery !== undefined
      || patch.paymentStatus !== undefined
      || patch.checkInStatus !== undefined
      || patch.profitFilter !== undefined
      || patch.needsAttentionOnly !== undefined
      || patch.datePreset !== undefined
      || patch.customFrom !== undefined
      || patch.customTo !== undefined) {
      next.page = 1
    }
    setSearchParams(contractsFiltersToSearchParams(next), { replace: true })
  }, [searchParams, setSearchParams])

  const clearInfluencerFilter = useCallback(() => {
    updateFilters({ influencerId: 'all' })
  }, [updateFilters])

  const loadPerformance = useCallback(async () => {
    if (!user) return
    setPerformanceLoading(true)
    setPerformanceError(null)
    try {
      const data = parsePerformanceRecordsResponse(await api.get('/api/influencers/performance-records'))
      setRecords(data.records.map((row) => normalizePerformanceRecord(row)))
    } catch (err: unknown) {
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
    () => resolveContractsDateRange(filters),
    [filters],
  )

  const allRows: InfluencerContractListRow[] | null = useMemo(() => {
    if (records === null || payments === null) return null
    return buildInfluencerContractListRows({
      records,
      roster: influencers,
      payments,
    })
  }, [records, payments, influencers])

  const filteredRows = useMemo(() => {
    if (!allRows) return []
    return filterContractListRows(allRows, filters, dateRange)
  }, [allRows, filters, dateRange])

  const sortedRows = useMemo(
    () => sortContractListRows(filteredRows, filters.sortKey, filters.sortDirection),
    [filteredRows, filters.sortKey, filters.sortDirection],
  )

  const pagination = useMemo(
    () => paginateContractListRows(sortedRows, filters.page),
    [sortedRows, filters.page],
  )

  const filteredInfluencer = useMemo(() => {
    if (filters.influencerId === 'all') return null
    return resolveInfluencerById(influencers, filters.influencerId)
  }, [filters.influencerId, influencers])

  const campaignOptions = useMemo(() => {
    const names = new Set<string>()
    ;(allRows || []).forEach((row) => {
      if (row.campaignName) names.add(row.campaignName)
    })
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [allRows])

  const loading = authLoading || rosterLoading || performanceLoading || paymentsLoading
  const error = rosterError || performanceError || paymentsError

  return {
    loading,
    error,
    reload,
    filters,
    updateFilters,
    clearInfluencerFilter,
    filteredInfluencer,
    allRows,
    filteredRows,
    pageRows: pagination.rows,
    totalRows: pagination.total,
    totalPages: pagination.totalPages,
    campaignOptions,
    influencers,
  }
}
