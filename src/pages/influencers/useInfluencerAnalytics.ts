import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { useInfluencers } from '../../contexts/InfluencersContext'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import type { InfluencerPerformanceInput, InfluencerPerformanceRecordsResponse } from '../../types/influencer'
import {
  buildInfluencerAnalyticsSnapshot,
  campaignOptionsFromContracts,
  platformOptionsFromContracts,
  readAnalyticsFiltersFromSearchParams,
  analyticsFiltersToSearchParams,
  type InfluencerAnalyticsFilters,
  type InfluencerAnalyticsSnapshot,
} from './influencerAnalyticsUtils'
import { buildInfluencerDashboardSnapshot } from './influencerDashboardUtils'

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

function readFilters(params: URLSearchParams): InfluencerAnalyticsFilters {
  return readAnalyticsFiltersFromSearchParams(params)
}

function filtersToParams(filters: InfluencerAnalyticsFilters): URLSearchParams {
  return analyticsFiltersToSearchParams(filters)
}

export function useInfluencerAnalytics() {
  const { user, loading: authLoading } = useAuth()
  const { influencers, loading: rosterLoading, loadError: rosterError } = useInfluencers()
  const [searchParams, setSearchParams] = useSearchParams()
  const [records, setRecords] = useState<InfluencerPerformanceInput[] | null>(null)
  const [performanceError, setPerformanceError] = useState<string | null>(null)
  const [performanceLoading, setPerformanceLoading] = useState(true)
  const [compareIds, setCompareIds] = useState<string[]>([])

  const filters = useMemo(() => readFilters(searchParams), [searchParams])

  const updateFilters = useCallback((patch: Partial<InfluencerAnalyticsFilters>) => {
    const next = { ...readFilters(searchParams), ...patch }
    setSearchParams(filtersToParams(next), { replace: patch.influencerId !== undefined ? false : true })
  }, [searchParams, setSearchParams])

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

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

  useEffect(() => {
    if (authLoading || !user) return
    void loadPerformance()
  }, [authLoading, user, loadPerformance])

  const snapshot: InfluencerAnalyticsSnapshot | null = useMemo(() => {
    if (records === null) return null
    return buildInfluencerAnalyticsSnapshot({ records, roster: influencers, filters })
  }, [records, influencers, filters])

  const dashboardForOptions = useMemo(() => {
    if (records === null) return null
    return buildInfluencerDashboardSnapshot({
      records,
      roster: influencers,
      range: null,
      groupMode: 'contract',
    })
  }, [records, influencers])

  const campaignOptions = useMemo(
    () => (dashboardForOptions ? campaignOptionsFromContracts(dashboardForOptions.contracts) : []),
    [dashboardForOptions],
  )
  const platformOptions = useMemo(
    () => (dashboardForOptions ? platformOptionsFromContracts(dashboardForOptions.contracts) : []),
    [dashboardForOptions],
  )

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((row) => row !== id)
      if (current.length >= 3) return current
      return [...current, id]
    })
  }, [])

  const comparePoints = useMemo(() => {
    if (!snapshot) return []
    return snapshot.comparisonPool.filter((point) => compareIds.includes(point.id))
  }, [snapshot, compareIds])

  const loading = authLoading || rosterLoading || performanceLoading
  const error = rosterError || performanceError

  return {
    loading,
    error,
    reload: loadPerformance,
    filters,
    updateFilters,
    resetFilters,
    snapshot,
    campaignOptions,
    platformOptions,
    influencers,
    compareIds,
    toggleCompare,
    comparePoints,
  }
}
