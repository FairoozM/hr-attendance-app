import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
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
  buildInfluencerProfileSnapshot,
  resolveInfluencerById,
  type InfluencerProfileSnapshot,
  type InfluencerProfileTab,
} from './influencerProfileUtils'

const VALID_TABS: InfluencerProfileTab[] = [
  'overview',
  'contracts',
  'performance',
  'payments',
  'notes',
]

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

export function useInfluencerProfile() {
  const { influencerId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, loading: authLoading } = useAuth()
  const { influencers, loading: rosterLoading, loadError: rosterError } = useInfluencers()

  const [records, setRecords] = useState<InfluencerPerformanceInput[] | null>(null)
  const [payments, setPayments] = useState<InfluencerContractPayment[] | null>(null)
  const [performanceError, setPerformanceError] = useState<string | null>(null)
  const [paymentsError, setPaymentsError] = useState<string | null>(null)
  const [performanceLoading, setPerformanceLoading] = useState(true)
  const [paymentsLoading, setPaymentsLoading] = useState(true)

  const tabParam = searchParams.get('tab')
  const activeTab: InfluencerProfileTab = VALID_TABS.includes(tabParam as InfluencerProfileTab)
    ? tabParam as InfluencerProfileTab
    : 'overview'

  const setActiveTab = useCallback((tab: InfluencerProfileTab) => {
    const params = new URLSearchParams(searchParams)
    if (tab === 'overview') params.delete('tab')
    else params.set('tab', tab)
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

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

  const rosterInfluencer = useMemo(
    () => resolveInfluencerById(influencers, influencerId),
    [influencers, influencerId],
  )

  const snapshot: InfluencerProfileSnapshot | null = useMemo(() => {
    if (records === null || payments === null || !influencerId) return null
    return buildInfluencerProfileSnapshot({
      influencerId,
      roster: influencers,
      records,
      payments,
    })
  }, [records, payments, influencers, influencerId])

  const loading = authLoading || rosterLoading || performanceLoading || paymentsLoading
  const error = rosterError || performanceError || paymentsError
  const notFound = !loading && !rosterInfluencer && records !== null

  return {
    influencerId,
    loading,
    error,
    notFound,
    reload,
    rosterInfluencer,
    snapshot,
    activeTab,
    setActiveTab,
  }
}
