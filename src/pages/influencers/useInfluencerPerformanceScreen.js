import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import { useAuth, canMutateInfluencerPerformance, canViewInfluencerPerformanceNetProfit } from '../../contexts/AuthContext'
import { useInfluencers } from '../../contexts/InfluencersContext'
import {
  buildContractRows,
  computeContractRankings,
  createInfluencerFromAppRecord,
  createMockPerformanceRecords,
  dedupePerformanceRecords,
  getVideoContractTimelines,
  mockInfluencers,
  normalizePerformanceRecord,
  toNumber,
} from '../../utils/influencerPerformanceUtils'
import {
  addTombstone,
  compareValues,
  isSeededMockPerformanceRecord,
  loadStoredRecords,
  mergePerformanceRecordIntoList,
  pruneTombstones,
  saveRecords,
} from './influencerPerformanceScreenShared'
import { fmtISO } from '../../utils/dateFormat'

function getContractIsoSpan(contract) {
  const start = fmtISO(contract?.contractStartDate || contract?.startDate || '')
  const end = fmtISO(contract?.latest?.date || contract?.latestDate || contract?.contractStartDate || '')
  const s = start || end
  const e = end || start
  if (!s && !e) return null
  return s <= e ? { start: s, end: e } : { start: e, end: s }
}

/** Inclusive overlap: contract window vs optional filter from/to (YYYY-MM-DD). */
function contractMatchesDateFilter(contract, filterFrom, filterTo) {
  const hasFilter = Boolean(filterFrom || filterTo)
  const span = getContractIsoSpan(contract)
  if (!span) return !hasFilter
  if (!hasFilter) return true
  if (filterFrom && !filterTo) return span.end >= filterFrom
  if (!filterFrom && filterTo) return span.start <= filterTo
  let lo = filterFrom
  let hi = filterTo
  if (lo && hi && lo > hi) {
    const t = lo
    lo = hi
    hi = t
  }
  return span.start <= hi && span.end >= lo
}

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
  const [sort, setSort] = useState({ key: 'rank', direction: 'asc' })
  const [editingRecord, setEditingRecord] = useState(null)
  const [editingContract, setEditingContract] = useState(null)
  const [isAddRecordOpen, setIsAddRecordOpen] = useState(false)
  const [activeMonitorContractId, setActiveMonitorContractId] = useState(null)
  const [contractTimelineQuery, setContractTimelineQuery] = useState('')
  const [tableDateFrom, setTableDateFrom] = useState('')
  const [tableDateTo, setTableDateTo] = useState('')
  const contractTimelineAnchorRef = useRef(null)
  const canWritePerformance = canMutateInfluencerPerformance(user)
  const showNetProfitColumn = canViewInfluencerPerformanceNetProfit(user)

  useEffect(() => {
    if (authLoading || !user) return
    if (sort.key === 'netProfitAed' && !showNetProfitColumn) {
      setSort({ key: 'rank', direction: 'asc' })
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
        const tombstones = pruneTombstones()
        const serverIds = new Set(server.map((r) => String(r.id)).filter(Boolean))
        const localRaw = loadStoredRecords() || []
        const local = localRaw
          .map((r) => normalizePerformanceRecord(r))
          .filter((record) => !isSeededMockPerformanceRecord(record))
          .filter((record) => !tombstones.has(String(record.id)))
        const localOnlyCount = local.reduce((count, record) => (
          serverIds.has(String(record.id)) ? count : count + 1
        ), 0)
        const merged = dedupePerformanceRecords([...server, ...local])
        if (cancelled) return
        setServerMergedOnce(true)
        if (merged.length > 0) {
          setRecords(merged)
          if (canMutateInfluencerPerformance(user) && localOnlyCount > 0) {
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
    }
  }, [influencers.length, influencersById, influencersLoading, records, persistRecordsIfCan])

  const videoContracts = useMemo(
    () => getVideoContractTimelines(allRecords, influencers),
    [allRecords, influencers],
  )

  useEffect(() => {
    if (!activeMonitorContractId) return
    const activeContract = videoContracts.find((contract) => String(contract.id) === String(activeMonitorContractId))
    if (!activeContract) setActiveMonitorContractId(null)
  }, [activeMonitorContractId, videoContracts])

  const rankingsByContractId = useMemo(
    () => computeContractRankings(videoContracts),
    [videoContracts],
  )

  const rankingByRecordId = useMemo(() => {
    const m = new Map()
    videoContracts.forEach((contract) => {
      const cid = contract.id
      const info = rankingsByContractId.get(cid)
      if (info) {
        ;(contract.records || []).forEach((record) => m.set(record.id, info))
      }
    })
    return m
  }, [videoContracts, rankingsByContractId])

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

  const contractRowsAll = useMemo(
    () => buildContractRows(allRecords, influencers, rankingsByContractId, sort),
    [allRecords, influencers, rankingsByContractId, sort],
  )

  const contractsTotal = contractRowsAll.length

  const filteredContracts = useMemo(() => {
    const from = fmtISO(tableDateFrom)
    const to = fmtISO(tableDateTo)
    if (!from && !to) return contractRowsAll
    return contractRowsAll.filter((row) => contractMatchesDateFilter(row, from, to))
  }, [contractRowsAll, tableDateFrom, tableDateTo])

  const activeMonitorContracts = useMemo(() => (
    activeMonitorContractId
      ? videoContracts.filter((contract) => String(contract.id) === String(activeMonitorContractId))
      : []
  ), [activeMonitorContractId, videoContracts])

  const contractTimelineOptions = useMemo(() => {
    const q = contractTimelineQuery.trim().toLowerCase()
    return videoContracts.filter((contract) => {
      if (!q) return true
      const haystack = [
        contract.influencer?.name,
        contract.influencer?.username,
        contract.campaignName,
        contract.videoTitle,
        contract.contractStartDate,
        contract.latest?.date || contract.latestDate,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [contractTimelineQuery, videoContracts])

  function toggleActiveMonitorContract(contract) {
    if (!contract?.id) return
    const isSameContract = String(activeMonitorContractId || '') === String(contract.id)
    setActiveMonitorContractId(isSameContract ? null : contract.id)
    requestAnimationFrame(() => {
      setTimeout(() => {
        contractTimelineAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 80)
    })
  }

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
    setActiveMonitorContractId(contract.id || null)
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

  async function handleDelete(id) {
    const prev = records || []
    const record = prev.find((item) => item.id === id) || allRecords.find((item) => item.id === id)
    if (!record) return
    const name = influencersById.get(String(record.influencerId))?.name || 'this record'
    if (!window.confirm(`Delete performance record for ${name}?`)) return

    if (!canMutateInfluencerPerformance(userRef.current)) {
      setSyncHint('This account cannot delete Influencer Performance records.')
      return
    }

    const ids = new Set(
      prev
        .filter((r) => (
          r.id === id ||
          (
            r.contractId &&
            record.contractId &&
            r.contractId === record.contractId &&
            r.date && record.date && r.date === record.date
          )
        ))
        .map((r) => r.id)
        .filter(Boolean),
    )
    if (ids.size === 0) ids.add(id)

    setSyncHint(ids.size > 1 ? `Deleting ${ids.size} records…` : 'Deleting…')
    try {
      for (const rid of ids) {
        await api.delete(`/api/influencers/performance-records/${encodeURIComponent(rid)}`)
        addTombstone(rid)
      }
      const next = prev.filter((r) => !ids.has(r.id))
      setRecords(next)
      saveRecords(next)
      if (editingRecord && ids.has(editingRecord.id)) setEditingRecord(null)
      setSyncHint('')
    } catch (err) {
      console.warn('[InfluencerPerformance] server delete failed', err)
      setSyncHint(err?.message || 'Server delete failed — record kept. Try again.')
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
    isAddRecordOpen,
    setIsAddRecordOpen,
    activeMonitorContractId,
    setActiveMonitorContractId,
    contractTimelineQuery,
    setContractTimelineQuery,
    tableDateFrom,
    setTableDateFrom,
    tableDateTo,
    setTableDateTo,
    contractsTotal,
    contractTimelineOptions,
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
    toggleActiveMonitorContract,
    persistRecordsIfCan,
  }
}
