import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { useInfluencers } from '../../contexts/InfluencersContext'
import { normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'
import type { InfluencerPerformanceInput, InfluencerPerformanceRecordsResponse } from '../../types/influencer'
import {
  buildInfluencerDashboardSnapshot,
  resolveDashboardDateRange,
  type InfluencerDashboardDatePreset,
  type InfluencerDashboardGroupMode,
  type InfluencerDashboardSnapshot,
} from './influencerDashboardUtils'

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

export function useInfluencerDashboard() {
  const { user, loading: authLoading } = useAuth()
  const { influencers, loading: rosterLoading, loadError: rosterError } = useInfluencers()

  const [records, setRecords] = useState<InfluencerPerformanceInput[] | null>(null)
  const [performanceError, setPerformanceError] = useState<string | null>(null)
  const [performanceLoading, setPerformanceLoading] = useState(true)

  const [datePreset, setDatePreset] = useState<InfluencerDashboardDatePreset>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [groupMode, setGroupMode] = useState<InfluencerDashboardGroupMode>('influencer')

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
      console.warn('[InfluencerDashboard] performance load failed', err)
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

  const dateRange = useMemo(
    () => resolveDashboardDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  )

  const snapshot: InfluencerDashboardSnapshot | null = useMemo(() => {
    if (records === null) return null
    return buildInfluencerDashboardSnapshot({
      records,
      roster: influencers,
      range: dateRange,
      groupMode,
    })
  }, [records, influencers, dateRange, groupMode])

  const loading = authLoading || rosterLoading || performanceLoading
  const error = rosterError || performanceError

  return {
    loading,
    error,
    reload: loadPerformance,
    snapshot,
    datePreset,
    setDatePreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    groupMode,
    setGroupMode,
    rosterTotal: influencers.length,
  }
}
