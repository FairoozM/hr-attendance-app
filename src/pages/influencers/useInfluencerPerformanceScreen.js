import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import { useAuth, canMutateInfluencerPerformance, canViewInfluencerPerformanceNetProfit } from '../../contexts/AuthContext'
import { useInfluencers } from '../../contexts/InfluencersContext'
import {
  computeContractRankings,
  createInfluencerFromAppRecord,
  createMockPerformanceRecords,
  dedupePerformanceRecords,
  getVideoContractKey,
  getVideoContractTimelines,
  mockInfluencers,
  normalizePerformanceRecord,
  toNumber,
} from '../../utils/influencerPerformanceUtils'
import {
  compareValues,
  isSeededMockPerformanceRecord,
  loadStoredRecords,
  mergePerformanceRecordIntoList,
  saveRecords,
} from './influencerPerformanceScreenShared'

export function useInfluencerPerformanceScreen() {
  const { user, loading: authLoading } = useAuth()
  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  const { influencers: appInfluencers = [], loading: influencersLoading } = useInfluencers()
  const [records, setRecords] = useState(null)
  const [serverMergedOnce, setServerMergedOnce] = useState(false)
  const [syncHint, setSyncHint] = useState('')
  const [sort, setSort] = useState({ key: 'date', direction: 'desc' })
  const [editingRecord, setEditingRecord] = useState(null)
  const [editingContract, setEditingContract] = useState(null)
  const [viewRecord, setViewRecord] = useState(null)
  const [isAddRecordOpen, setIsAddRecordOpen] = useState(false)
  const [activeMonitorInfluencerId, setActiveMonitorInfluencerId] = useState(null)
  const contractTimelineAnchorRef = useRef(null)
  const canWritePerformance = canMutateInfluencerPerformance(user)
  const showNetProfitColumn = canViewInfluencerPerformanceNetProfit(user)

  useEffect(() => {
    if (authLoading || !user) return
    if (sort.key === 'netProfitAed' && !showNetProfitColumn) {
      setSort({ key: 'date', direction: 'desc' })
    }
  }, [authLoading, user, sort.key, showNetProfitColumn])

  const influencers = useMemo(() => {
    if (appInfluencers.length > 0) {
      return appInfluencers.map(createInfluencerFromAppRecord)
    }
    if (influencersLoading) return []
    return mockInfluencers
  }, [appInfluencers, influencersLoading])

  const influencersById = useMemo(
    () => new Map(influencers.map((influencer) => [String(influencer.id), influencer])),
    [influencers],
  )

  const persistRecordsIfCan = useCallback(async (nextList) => {
    const u = userRef.current
    const list = dedupePerformanceRecords(nextList || [])
    if (!canMutateInfluencerPerformance(u)) {
      setSyncHint('This account cannot save Influencer Performance to the server. Ask an admin to enable Influencer Performance access.')
      return
    }
    try {
      const result = await api.post('/api/influencers/performance-records/bulk-upsert', { records: list })
      saveRecords(list)
      setSyncHint(result?.skipped ? `${result.skipped} record(s) were not saved because the influencer no longer exists on the server.` : '')
    } catch (err) {
      console.warn('[InfluencerPerformance] server save failed', err)
      saveRecords(list)
      setSyncHint(err.message || 'Could not save to server (kept a copy in this browser).')
    }
  }, [])

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    ;(async () => {
      setSyncHint('')
      try {
        const data = await api.get('/api/influencers/performance-records')
        const server = Array.isArray(data?.records)
          ? data.records.map((r) => normalizePerformanceRecord(r))
          : []
        const localRaw = loadStoredRecords() || []
        const local = localRaw
          .map((r) => normalizePerformanceRecord(r))
          .filter((record) => !isSeededMockPerformanceRecord(record))
        const merged = dedupePerformanceRecords([...server, ...local])
        if (cancelled) return
        setServerMergedOnce(true)
        if (merged.length > 0) {
          setRecords(merged)
          if (canMutateInfluencerPerformance(user) && merged.length > server.length) {
            const result = await api.post('/api/influencers/performance-records/bulk-upsert', { records: merged })
            if (result?.skipped) {
              setSyncHint(`${result.skipped} record(s) were not saved because the influencer no longer exists on the server.`)
            }
            const again = await api.get('/api/influencers/performance-records')
            if (!cancelled && Array.isArray(again?.records)) {
              const next = dedupePerformanceRecords(again.records.map((r) => normalizePerformanceRecord(r)))
              setRecords(next)
              saveRecords(next)
            }
          } else {
            saveRecords(merged)
          }
        } else {
          setRecords([])
        }
      } catch (err) {
        console.warn('[InfluencerPerformance] server load failed', err)
        if (!cancelled) {
          const local = loadStoredRecords()
          setRecords(local?.length ? local.map((r) => normalizePerformanceRecord(r)) : [])
          setSyncHint('Could not load server data; showing offline copy if available.')
          setServerMergedOnce(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authLoading, user])

  useEffect(() => {
    if (!serverMergedOnce || records === null || influencers.length === 0 || influencersLoading) return
    if (records.length > 0) return
    if (!import.meta.env.DEV) return
    setRecords(createMockPerformanceRecords(influencers))
  }, [serverMergedOnce, records, influencers, influencersLoading])

  useEffect(() => {
    if (records) saveRecords(records)
  }, [records])

  const allRecords = useMemo(() => (
    dedupePerformanceRecords(records || []).filter((record) => influencersById.has(String(record.influencerId)))
  ), [influencersById, records])

  useEffect(() => {
    if (!records || influencers.length === 0 || influencersLoading) return
    const cleaned = dedupePerformanceRecords(records).filter((record) => influencersById.has(String(record.influencerId)))
    if (cleaned.length !== records.length) {
      setRecords(cleaned)
      void persistRecordsIfCan(cleaned)
      if (activeMonitorInfluencerId && !influencersById.has(String(activeMonitorInfluencerId))) {
        setActiveMonitorInfluencerId(null)
      }
    }
  }, [activeMonitorInfluencerId, influencers.length, influencersById, influencersLoading, records, persistRecordsIfCan])

  const videoContracts = useMemo(
    () => getVideoContractTimelines(allRecords, influencers),
    [allRecords, influencers],
  )

  const rankingsByContractId = useMemo(
    () => computeContractRankings(videoContracts),
    [videoContracts],
  )

  const rankingByRecordId = useMemo(() => {
    const m = new Map()
    allRecords.forEach((record) => {
      const cid = getVideoContractKey(record)
      const info = rankingsByContractId.get(cid)
      if (info) m.set(record.id, info)
    })
    return m
  }, [allRecords, rankingsByContractId])

  const filteredRecords = useMemo(() => {
    return [...allRecords].sort((a, b) => {
      if (sort.key === 'rank') {
        const scoreA = rankingByRecordId.get(a.id)?.score ?? -1
        const scoreB = rankingByRecordId.get(b.id)?.score ?? -1
        if (scoreB !== scoreA) {
          return sort.direction === 'asc' ? scoreB - scoreA : scoreA - scoreB
        }
        return compareValues(a.date, b.date, 'desc')
      }
      if (sort.key === 'netProfitAed') {
        return compareValues(toNumber(a.netProfitAed), toNumber(b.netProfitAed), sort.direction)
      }
      const influencerA = influencersById.get(String(a.influencerId))
      const influencerB = influencersById.get(String(b.influencerId))
      const valueA =
        sort.key === 'influencer' ? influencerA?.name :
          a[sort.key]
      const valueB =
        sort.key === 'influencer' ? influencerB?.name :
          b[sort.key]
      return compareValues(valueA, valueB, sort.direction)
    })
  }, [allRecords, influencersById, rankingByRecordId, sort])

  // One row per video contract: aggregate totals, anchor to the contract start
  // date, and reuse rankingsByContractId for ranking lookups (row id === contract id).
  const filteredContracts = useMemo(() => {
    const rows = videoContracts.map((contract) => ({
      id: contract.id,
      contractId: contract.id,
      influencerId: contract.influencerId,
      influencer: contract.influencer,
      platform: contract.platform,
      postUrl: contract.postUrl,
      campaignName: contract.campaignName,
      videoTitle: contract.videoTitle,
      contractStartDate: contract.contractStartDate,
      date: contract.contractStartDate,
      monitoringDays: contract.monitoringDays,
      recordedDays: contract.recordedDays,
      days: contract.days,
      latest: contract.latest,
      records: contract.records,
      cost: contract.totals.cost,
      views: contract.totals.views,
      likes: contract.totals.likes,
      comments: contract.totals.comments,
      shares: contract.totals.shares,
      salesAed: contract.totals.salesAed,
      netProfitAed: contract.totals.netProfitAed,
      engagementRate: contract.averageEngagementRate,
    }))
    return rows.sort((a, b) => {
      if (sort.key === 'rank') {
        const scoreA = rankingsByContractId.get(a.id)?.score ?? -1
        const scoreB = rankingsByContractId.get(b.id)?.score ?? -1
        if (scoreB !== scoreA) {
          return sort.direction === 'asc' ? scoreB - scoreA : scoreA - scoreB
        }
        return compareValues(a.date, b.date, 'desc')
      }
      if (sort.key === 'netProfitAed') {
        return compareValues(toNumber(a.netProfitAed), toNumber(b.netProfitAed), sort.direction)
      }
      const influencerA = influencersById.get(String(a.influencerId))
      const influencerB = influencersById.get(String(b.influencerId))
      const valueA = sort.key === 'influencer' ? influencerA?.name : a[sort.key]
      const valueB = sort.key === 'influencer' ? influencerB?.name : b[sort.key]
      return compareValues(valueA, valueB, sort.direction)
    })
  }, [videoContracts, rankingsByContractId, influencersById, sort])

  const activeMonitorContracts = useMemo(() => {
    if (!activeMonitorInfluencerId) return []
    return videoContracts.filter((contract) => String(contract.influencerId) === String(activeMonitorInfluencerId))
  }, [activeMonitorInfluencerId, videoContracts])

  function handleSort(key) {
    setSort((prev) => {
      if (key === 'rank' && prev.key !== 'rank') {
        return { key: 'rank', direction: 'asc' }
      }
      return {
        key,
        direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
      }
    })
  }

  function handlePodiumSelectContract(contract) {
    if (!contract?.influencerId) return
    setActiveMonitorInfluencerId(contract.influencerId)
    requestAnimationFrame(() => {
      setTimeout(() => {
        contractTimelineAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 80)
    })
  }

  function handleSortPreset(value) {
    const [key, direction] = String(value || 'date:desc').split(':')
    setSort({ key, direction: direction === 'asc' ? 'asc' : 'desc' })
  }

  function handleSubmit(record) {
    setRecords((prev) => {
      const list = prev || []
      const next = mergePerformanceRecordIntoList(list, record)
      void persistRecordsIfCan(next)
      return next
    })
    setEditingRecord(null)
    setIsAddRecordOpen(false)
  }

  function handleDelete(id) {
    const record = allRecords.find((item) => item.id === id)
    const name = influencersById.get(String(record?.influencerId))?.name || 'this record'
    if (!window.confirm(`Delete performance record for ${name}?`)) return
    const prev = records || []
    const next = prev.filter((item) => item.id !== id)
    setRecords(next)
    saveRecords(next)
    if (viewRecord?.id === id) setViewRecord(null)
    if (editingRecord?.id === id) setEditingRecord(null)
    if (canMutateInfluencerPerformance(userRef.current)) {
      void api.delete(`/api/influencers/performance-records/${encodeURIComponent(id)}`).catch((err) => {
        console.warn('[InfluencerPerformance] server delete failed', err)
        setSyncHint(err.message || 'Deleted locally; server delete failed — refresh to reconcile.')
      })
    }
  }

  function handleSaveContractEdit() {
    if (!editingContract?.selectedInfluencerId) return
    const selectedInfluencer = influencersById.get(String(editingContract.selectedInfluencerId))
    if (!selectedInfluencer) return
    const contractRecordIds = new Set((editingContract.contract.records || []).map((r) => r.id))
    const prev = records || []
    const next = prev.map((record) => (
      contractRecordIds.has(record.id)
        ? {
            ...record,
            influencerId: selectedInfluencer.id,
            platform: selectedInfluencer.platform,
            campaignName: record.campaignName || selectedInfluencer.assignedCampaign,
            updatedAt: new Date().toISOString(),
          }
        : record
    ))
    setRecords(next)
    void persistRecordsIfCan(next)
    setActiveMonitorInfluencerId(selectedInfluencer.id)
    setEditingContract(null)
  }

  return {
    user,
    authLoading,
    influencers,
    influencersById,
    influencersLoading,
    records,
    setRecords,
    syncHint,
    setSyncHint,
    sort,
    setSort,
    editingRecord,
    setEditingRecord,
    editingContract,
    setEditingContract,
    viewRecord,
    setViewRecord,
    isAddRecordOpen,
    setIsAddRecordOpen,
    activeMonitorInfluencerId,
    setActiveMonitorInfluencerId,
    contractTimelineAnchorRef,
    canWritePerformance,
    showNetProfitColumn,
    allRecords,
    filteredRecords,
    filteredContracts,
    videoContracts,
    rankingsByContractId,
    rankingByRecordId,
    activeMonitorContracts,
    handleSort,
    handleSortPreset,
    handleSubmit,
    handleDelete,
    handleSaveContractEdit,
    handlePodiumSelectContract,
    persistRecordsIfCan,
  }
}
