import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { fetchInfluencerContractPayments } from '../../api/influencerContractPayments'
import { useAuth } from '../../contexts/AuthContext'
import { useInfluencers } from '../../contexts/InfluencersContext'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import type {
  InfluencerContractPayment,
  InfluencerModuleTimelineEvent,
  InfluencerModuleTimelineEventType,
  InfluencerModuleTimelineFilters,
  InfluencerModuleTimelineGroup,
  InfluencerModuleTimelineStatus,
  InfluencerModuleTimelineSummary,
  InfluencerPerformanceInput,
  InfluencerPerformanceRecordsResponse,
} from '../../types/influencer'
import {
  TIMELINE_PAGE_SIZE,
  buildInfluencerModuleTimelineEvents,
  contractOptionsFromEvents,
  defaultTimelineFilters,
  filterTimelineEvents,
  groupTimelineEvents,
  paginateTimelineEvents,
  resolveTimelineDateRange,
  summarizeTimelineEvents,
} from './influencerModuleTimelineUtils'

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

function readFiltersFromSearchParams(params: URLSearchParams): InfluencerModuleTimelineFilters {
  const defaults = defaultTimelineFilters()
  const eventType = params.get('eventType')
  const status = params.get('status')
  const groupMode = params.get('group')

  return {
    datePreset: (params.get('period') as InfluencerModuleTimelineFilters['datePreset']) || defaults.datePreset,
    customFrom: params.get('from') || '',
    customTo: params.get('to') || '',
    influencerId: params.get('influencer') || 'all',
    contractId: params.get('contract') || 'all',
    eventType: (eventType as InfluencerModuleTimelineEventType) || 'all',
    status: (status as InfluencerModuleTimelineStatus) || 'all',
    needsAttentionOnly: params.get('attention') === '1',
    groupMode: groupMode === 'influencer' || groupMode === 'contract' ? groupMode : 'date',
  }
}

function filtersToSearchParams(filters: InfluencerModuleTimelineFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.datePreset !== 'all_time') params.set('period', filters.datePreset)
  if (filters.customFrom) params.set('from', filters.customFrom)
  if (filters.customTo) params.set('to', filters.customTo)
  if (filters.influencerId !== 'all') params.set('influencer', filters.influencerId)
  if (filters.contractId !== 'all') params.set('contract', filters.contractId)
  if (filters.eventType !== 'all') params.set('eventType', filters.eventType)
  if (filters.status !== 'all') params.set('status', filters.status)
  if (filters.needsAttentionOnly) params.set('attention', '1')
  if (filters.groupMode !== 'date') params.set('group', filters.groupMode)
  return params
}

export function useInfluencerModuleTimeline() {
  const { user, loading: authLoading } = useAuth()
  const { influencers, loading: rosterLoading, loadError: rosterError } = useInfluencers()
  const [searchParams, setSearchParams] = useSearchParams()

  const [records, setRecords] = useState<InfluencerPerformanceInput[] | null>(null)
  const [payments, setPayments] = useState<InfluencerContractPayment[] | null>(null)
  const [performanceError, setPerformanceError] = useState<string | null>(null)
  const [paymentsError, setPaymentsError] = useState<string | null>(null)
  const [performanceLoading, setPerformanceLoading] = useState(true)
  const [paymentsLoading, setPaymentsLoading] = useState(true)
  const [visibleCount, setVisibleCount] = useState(TIMELINE_PAGE_SIZE)

  const filters = useMemo(
    () => readFiltersFromSearchParams(searchParams),
    [searchParams],
  )

  const updateFilters = useCallback((patch: Partial<InfluencerModuleTimelineFilters>) => {
    const next = { ...readFiltersFromSearchParams(searchParams), ...patch }
    setSearchParams(filtersToSearchParams(next), { replace: true })
    setVisibleCount(TIMELINE_PAGE_SIZE)
  }, [searchParams, setSearchParams])

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true })
    setVisibleCount(TIMELINE_PAGE_SIZE)
  }, [setSearchParams])

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

  const allEvents: InfluencerModuleTimelineEvent[] | null = useMemo(() => {
    if (records === null || payments === null) return null
    return buildInfluencerModuleTimelineEvents({ records, roster: influencers, payments })
  }, [records, influencers, payments])

  const dateRange = useMemo(
    () => resolveTimelineDateRange(filters.datePreset, filters.customFrom, filters.customTo),
    [filters.datePreset, filters.customFrom, filters.customTo],
  )

  const filteredEvents = useMemo(() => {
    if (!allEvents) return []
    return filterTimelineEvents(allEvents, {
      range: dateRange,
      influencerId: filters.influencerId,
      contractId: filters.contractId,
      eventType: filters.eventType,
      status: filters.status,
      needsAttentionOnly: filters.needsAttentionOnly,
    })
  }, [allEvents, dateRange, filters])

  const summary: InfluencerModuleTimelineSummary | null = useMemo(() => {
    if (!allEvents) return null
    return summarizeTimelineEvents(filteredEvents)
  }, [allEvents, filteredEvents])

  const pagination = useMemo(
    () => paginateTimelineEvents(filteredEvents, visibleCount),
    [filteredEvents, visibleCount],
  )

  const groupedEvents: InfluencerModuleTimelineGroup[] = useMemo(
    () => groupTimelineEvents(pagination.visible, filters.groupMode),
    [pagination.visible, filters.groupMode],
  )

  const contractOptions = useMemo(
    () => contractOptionsFromEvents(allEvents || []),
    [allEvents],
  )

  const loadMore = useCallback(() => {
    setVisibleCount((count) => count + TIMELINE_PAGE_SIZE)
  }, [])

  const loading = authLoading || rosterLoading || performanceLoading || paymentsLoading
  const error = rosterError || performanceError || paymentsError

  return {
    loading,
    error,
    reload,
    filters,
    updateFilters,
    resetFilters,
    summary,
    groupedEvents,
    filteredTotal: pagination.total,
    visibleCount,
    remainingCount: Math.max(0, pagination.total - visibleCount),
    hasMore: pagination.hasMore,
    loadMore,
    influencers,
    contractOptions,
  }
}
