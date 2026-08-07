import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
} from '../../utils/influencerPerformanceUtils'
import {
  addTombstone,
  isSeededMockPerformanceRecord,
  loadStoredRecords,
  mergePerformanceRecordIntoList,
  pruneTombstones,
  saveRecords,
} from './influencerPerformanceScreenShared'
import {
  filterRankingRowsByDatePreset,
  type InfluencerPerformanceRankingDatePreset,
} from './influencerPerformanceRankingUtils'
import {
  readPerformanceSection,
  writePerformanceSection,
  type InfluencerPerformanceSection,
} from './influencerPerformanceSections'
import type {
  InfluencerContract,
  InfluencerContractRow,
  InfluencerPerformance,
  InfluencerPerformanceBulkUpsertResponse,
  InfluencerPerformanceInput,
  InfluencerPerformanceProfile,
  InfluencerPerformanceRecordsResponse,
  InfluencerPerformanceSort,
} from '../../types/influencer'

export type EditingContractState = {
  contract: InfluencerContract
  selectedInfluencerId: string | number | null | undefined
  query: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePerformanceRecordsResponse(data: unknown): InfluencerPerformanceRecordsResponse {
  if (!isPlainObject(data)) return { records: [] }
  const records = Array.isArray(data.records) ? data.records : []
  const contracts = Array.isArray(data.contracts) ? data.contracts : undefined
  return {
    records: records.filter((row): row is InfluencerPerformanceInput => isPlainObject(row)),
    contracts: contracts?.filter(isPlainObject),
  }
}

function parseBulkUpsertResponse(data: unknown): InfluencerPerformanceBulkUpsertResponse {
  if (!isPlainObject(data)) return {}
  return {
    success: typeof data.success === 'boolean' ? data.success : undefined,
    upserted: typeof data.upserted === 'number' ? data.upserted : undefined,
    skipped: typeof data.skipped === 'number' ? data.skipped : undefined,
    skippedTombstoned: typeof data.skippedTombstoned === 'number' ? data.skippedTombstoned : undefined,
  }
}

export function useInfluencerPerformanceScreen() {
  const { user, loading: authLoading } = useAuth()
  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  const { influencers: appInfluencers = [], loading: influencersLoading } = useInfluencers()
  const [records, setRecords] = useState<InfluencerPerformance[] | null>(null)
  const [serverMergedOnce, setServerMergedOnce] = useState(false)
  const [syncHint, setSyncHint] = useState('')
  const [sort, setSort] = useState<InfluencerPerformanceSort>({ key: 'rank', direction: 'asc' })
  const [editingRecord, setEditingRecord] = useState<InfluencerPerformance | InfluencerPerformanceInput | null>(null)
  const [editingContract, setEditingContract] = useState<EditingContractState | null>(null)
  const [isAddRecordOpen, setIsAddRecordOpen] = useState(false)
  const [activeMonitorContractId, setActiveMonitorContractId] = useState<string | number | null>(null)
  const [contractTimelineQuery, setContractTimelineQuery] = useState('')
  const [rankingDatePreset, setRankingDatePreset] = useState<InfluencerPerformanceRankingDatePreset>('all_time')
  const [rankingCustomFrom, setRankingCustomFrom] = useState('')
  const [rankingCustomTo, setRankingCustomTo] = useState('')
  const contractTimelineAnchorRef = useRef<HTMLDivElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const activeSection = readPerformanceSection(searchParams)
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
    () => new Map<string, InfluencerPerformanceProfile>(
      influencers.map((influencer) => [String(influencer.id), influencer]),
    ),
    [influencers],
  )

  const persistRecordsIfCan = useCallback(async (nextList: InfluencerPerformanceInput[]) => {
    const u = userRef.current
    const list = dedupePerformanceRecords(nextList || []).map(normalizePerformanceRecord)
    if (!canMutateInfluencerPerformance(u)) {
      setSyncHint('This account cannot save Influencer Performance to the server. Ask an admin to enable Influencer Performance access.')
      return
    }
    try {
      const result = parseBulkUpsertResponse(
        await api.post('/api/influencers/performance-records/bulk-upsert', { records: list }),
      )
      saveRecords(list)
      if (result?.skippedTombstoned) {
        setSyncHint(`${result.skippedTombstoned} deleted record(s) were not restored.`)
      } else {
        setSyncHint(result?.skipped ? `${result.skipped} record(s) were not saved because the influencer no longer exists on the server.` : '')
      }
    } catch (err: unknown) {
      console.warn('[InfluencerPerformance] server save failed', err)
      saveRecords(list)
      const message = err instanceof Error ? err.message : 'Could not save to server (kept a copy in this browser).'
      setSyncHint(message)
    }
  }, [])

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    ;(async () => {
      setSyncHint('')
      try {
        const data = parsePerformanceRecordsResponse(
          await api.get('/api/influencers/performance-records'),
        )
        const server = data.records.map((r) => normalizePerformanceRecord(r))
        const tombstones = pruneTombstones()
        const localRaw = loadStoredRecords() || []
        const local = localRaw
          .map((r) => normalizePerformanceRecord(r))
          .filter((record) => !isSeededMockPerformanceRecord(record))
          .filter((record) => !tombstones.has(String(record.id)))
        const localOnlyCount = local.reduce((count, record) => (
          server.some((serverRecord) => String(serverRecord.id) === String(record.id)) ? count : count + 1
        ), 0)
        if (cancelled) return
        setServerMergedOnce(true)
        setRecords(server)
        saveRecords(server)
        if (localOnlyCount > 0) {
          setSyncHint(`${localOnlyCount} cached local record(s) were found but were not auto-synced. Use restore if needed.`)
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
      setRecords(cleaned.map((record) => normalizePerformanceRecord(record)))
      void persistRecordsIfCan(cleaned)
    }
  }, [influencers.length, influencersById, influencersLoading, records, persistRecordsIfCan])

  const videoContracts = useMemo(
    () => getVideoContractTimelines(allRecords, influencers),
    [allRecords, influencers],
  )

  useEffect(() => {
    const contractFromUrl = searchParams.get('contract')
    if (!contractFromUrl) return
    setActiveMonitorContractId(contractFromUrl)
    if (readPerformanceSection(searchParams) !== 'timeline') {
      setSearchParams(writePerformanceSection(searchParams, 'timeline'), { replace: true })
    }
  }, [searchParams, setSearchParams])

  const setActiveSection = useCallback((section: InfluencerPerformanceSection) => {
    setSearchParams(writePerformanceSection(searchParams, section), { replace: false })
  }, [searchParams, setSearchParams])

  const influencerFilterId = searchParams.get('influencer') || ''
  const addFromUrl = searchParams.get('add') === '1'

  useEffect(() => {
    if (!addFromUrl || !canWritePerformance) return
    setIsAddRecordOpen(true)
  }, [addFromUrl, canWritePerformance])

  useEffect(() => {
    if (!activeMonitorContractId) return
    const activeContract = videoContracts.find((contract) => String(contract.id) === String(activeMonitorContractId))
    if (!activeContract) setActiveMonitorContractId(null)
  }, [activeMonitorContractId, videoContracts])

  const rankingsByContractId = useMemo(
    () => computeContractRankings(videoContracts),
    [videoContracts],
  )

  const contractRowsAll = useMemo(
    () => buildContractRows(allRecords, influencers, rankingsByContractId, sort),
    [allRecords, influencers, rankingsByContractId, sort],
  )

  const contractsTotal = contractRowsAll.length

  const filteredContracts = useMemo(() => {
    let list = contractRowsAll
    if (influencerFilterId) {
      list = list.filter((row) => String(row.influencerId) === String(influencerFilterId))
    }
    return filterRankingRowsByDatePreset(list, rankingDatePreset, rankingCustomFrom, rankingCustomTo)
  }, [contractRowsAll, rankingDatePreset, rankingCustomFrom, rankingCustomTo, influencerFilterId])

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

  function openTimelineSection() {
    setActiveSection('timeline')
    requestAnimationFrame(() => {
      setTimeout(() => {
        contractTimelineAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 80)
    })
  }

  function toggleActiveMonitorContract(contract: InfluencerContract | InfluencerContractRow | null | undefined) {
    if (!contract?.id) return
    const isSameContract = String(activeMonitorContractId || '') === String(contract.id)
    setActiveMonitorContractId(isSameContract ? null : contract.id)
    if (!isSameContract) openTimelineSection()
  }

  function handleSort(key: string) {
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

  function handlePodiumSelectContract(contract: InfluencerContract | null | undefined) {
    if (!contract?.influencerId) return
    setActiveMonitorContractId(contract.id || null)
    openTimelineSection()
  }

  function handleSortPreset(value: string) {
    const [key, direction] = String(value || 'date:desc').split(':')
    setSort({ key, direction: direction === 'asc' ? 'asc' : 'desc' })
  }

  function handleSubmit(record: InfluencerPerformanceInput) {
    setRecords((prev) => {
      const list = prev || []
      const next = mergePerformanceRecordIntoList(list, record)
      void persistRecordsIfCan(next)
      return next
    })
    setEditingRecord(null)
    setIsAddRecordOpen(false)
  }

  async function handleDelete(id: string | number) {
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
    if (ids.size === 0) ids.add(String(id))

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
    } catch (err: unknown) {
      console.warn('[InfluencerPerformance] server delete failed', err)
      const message = err instanceof Error ? err.message : 'Server delete failed — record kept. Try again.'
      setSyncHint(message)
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
    rankingDatePreset,
    setRankingDatePreset,
    rankingCustomFrom,
    setRankingCustomFrom,
    rankingCustomTo,
    setRankingCustomTo,
    contractsTotal,
    contractTimelineOptions,
    contractTimelineAnchorRef,
    activeSection,
    setActiveSection,
    canWritePerformance,
    showNetProfitColumn,
    allRecords,
    filteredContracts,
    influencerFilterId,
    videoContracts,
    rankingsByContractId,
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
