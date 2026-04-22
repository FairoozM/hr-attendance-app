import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { useAuth } from './AuthContext'
import {
  fetchInfluencersRaw,
  createInfluencer as createInfluencerApi,
  updateInfluencer as updateInfluencerApi,
  deleteInfluencer as deleteInfluencerApi,
  replaceInfluencersSnapshot,
} from '../lib/influencers'
import { normalizeInfluencerResponse } from '../lib/influencerResponse'

/** Synced from provider state for failure fallback (avoids stale closure). */
const influencersRefGlobal = { current: [] }

/** Legacy browser-only store (before server sync). Migrated once if API returns empty. */
const LEGACY_STORAGE_KEY = 'hr-influencers-v1'

function loadLegacyLocal() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (_) {}
  return null
}

/** Merge server + old browser-only lists: same id keeps the row with newer updatedAt. */
function mergeInfluencerListsById(base, extra) {
  const ts = (r) => {
    const u = r?.updatedAt || r?.createdAt
    const n = u ? new Date(u).getTime() : 0
    return Number.isNaN(n) ? 0 : n
  }
  const byId = new Map()
  for (const r of base || []) {
    if (r && r.id != null) byId.set(String(r.id), r)
  }
  for (const r of extra || []) {
    if (!r || r.id == null) continue
    const id = String(r.id)
    if (!byId.has(id)) {
      byId.set(id, r)
    } else if (ts(r) > ts(byId.get(id))) {
      byId.set(id, r)
    }
  }
  return Array.from(byId.values())
}

function canPersistInfluencersToServer(user) {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'warehouse') return true
  const m = user.permissions?.influencers || {}
  return !!(m.manage || m.approve || m.payments || m.agreements)
}

function listMetaForFullClientList(list) {
  const n = list.length
  return {
    total: n,
    totalPages: 1,
    page: 1,
    limit: n || 10,
    isFullListClientPaging: true,
  }
}

function applyFetchFailureState(setInfluencers, setListMeta, setLoadError, errMessage) {
  setLoadError(errMessage)
  const legacy = loadLegacyLocal()
  const prev = influencersRefGlobal.current
  if (prev.length > 0) return
  if (Array.isArray(legacy) && legacy.length > 0) {
    setInfluencers(legacy)
    setListMeta(listMetaForFullClientList(legacy))
    return
  }
  setInfluencers([])
  setListMeta(listMetaForFullClientList([]))
}

export const WORKFLOW_STAGES = [
  'New Lead', 'Contacted', 'Waiting for Price', 'Waiting for Insights',
  'Under Review', 'Shortlisted', 'Approved', 'Rejected',
  'Shoot Scheduled', 'Shot Completed', 'Waiting for Upload',
  'Uploaded', 'Payment Pending', 'Paid', 'Closed',
]

export const APPROVAL_STATUSES = ['Pending', 'Shortlisted', 'Approved', 'Rejected']
export const PAYMENT_STATUSES = [
  'Not Requested', 'Bank Details Pending', 'Ready for Payment', 'Payment Processing', 'Paid',
]
export const COLLABORATION_TYPES = [
  'Collaboration Post', 'Reel on Influencer Page', 'Story Only',
  'Reel + Story Package', 'Usage Rights Included', 'Custom',
]
export const CONTACT_STATUSES = [
  'Not Contacted', 'First Contact Made', 'In Discussion', 'Negotiating', 'Offer Shared', 'Deal Closed',
]
export const SHOOT_STATUSES = ['Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'Reschedule Needed']
export const AGREEMENT_STATUSES = ['Not Generated', 'Generated', 'Sent', 'Signed', 'Expired']
export const CURRENCIES = ['AED', 'USD', 'SAR', 'GBP', 'EUR']

const InfluencersContext = createContext(null)

function isUnauthorizedLoadError(message) {
  const m = String(message || '')
  return m.includes('401') || m.toLowerCase().includes('unauthorized')
}

export function InfluencersProvider({ children }) {
  const { user, logout } = useAuth()
  const [influencers, setInfluencers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [listMeta, setListMeta] = useState(() => listMetaForFullClientList([]))
  const userRef = useRef(user)
  const serverPageQueryRef = useRef({ page: 1, limit: 20 })

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    influencersRefGlobal.current = influencers
  }, [influencers])

  const hydrateInfluencers = useCallback(async (opts) => {
    const fetchOpts =
      opts && opts.page != null && opts.limit != null
        ? { page: opts.page, limit: opts.limit }
        : undefined

    const raw = await fetchInfluencersRaw(fetchOpts)
    const normalized = normalizeInfluencerResponse(raw)

    if (!normalized.isFullListClientPaging) {
      console.warn(
        '[influencers] Response total exceeds returned items; using server pagination metadata. Legacy merge is skipped for this response.',
      )
      serverPageQueryRef.current = {
        page: normalized.page,
        limit: normalized.limit,
      }
      setInfluencers(normalized.items)
      setListMeta({
        total: normalized.total,
        totalPages: normalized.totalPages,
        page: normalized.page,
        limit: normalized.limit,
        isFullListClientPaging: false,
      })
      setLoadError(null)
      return normalized.items
    }

    let serverList = normalized.items
    const legacy = loadLegacyLocal()
    let list = serverList
    let hadLegacy = Array.isArray(legacy) && legacy.length > 0
    if (hadLegacy) {
      list = mergeInfluencerListsById(serverList, legacy)
    }
    const mergedDiffersFromServer =
      hadLegacy && JSON.stringify(list) !== JSON.stringify(serverList)

    let loadErr = null
    const u = userRef.current

    if (mergedDiffersFromServer && canPersistInfluencersToServer(u)) {
      try {
        await replaceInfluencersSnapshot(list)
        try {
          localStorage.removeItem(LEGACY_STORAGE_KEY)
        } catch (_) {}
      } catch (putErr) {
        loadErr = putErr.message || 'Could not save merged influencers to the server'
        list = serverList
        hadLegacy = true
      }
    } else if (mergedDiffersFromServer && !canPersistInfluencersToServer(u)) {
      loadErr =
        'This browser had a local influencer list; it was merged for display only. Log in once with an account that can edit influencers (or admin) to upload it to the server.'
    } else if (hadLegacy && !mergedDiffersFromServer) {
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY)
      } catch (_) {}
    }

    setInfluencers(list)
    setListMeta(listMetaForFullClientList(list))
    setLoadError(loadErr)
    return list
  }, [])

  const reloadFromServer = useCallback(async () => {
    try {
      return await hydrateInfluencers()
    } catch (e) {
      const msg = e?.message || 'Failed to load influencers'
      if (isUnauthorizedLoadError(msg)) {
        logout()
        return null
      }
      applyFetchFailureState(setInfluencers, setListMeta, setLoadError, msg)
      return null
    }
  }, [hydrateInfluencers, logout])

  const retryLoad = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      await hydrateInfluencers()
    } catch (e) {
      const msg = e?.message || 'Failed to load influencers'
      if (isUnauthorizedLoadError(msg)) {
        logout()
        return
      }
      applyFetchFailureState(setInfluencers, setListMeta, setLoadError, msg)
    } finally {
      setLoading(false)
    }
  }, [hydrateInfluencers, logout])

  const refetchInfluencerPage = useCallback(
    async (next) => {
      serverPageQueryRef.current = { ...serverPageQueryRef.current, ...next }
      setLoading(true)
      setLoadError(null)
      try {
        await hydrateInfluencers(serverPageQueryRef.current)
      } catch (e) {
        const msg = e?.message || 'Failed to load influencers'
        if (isUnauthorizedLoadError(msg)) {
          logout()
          return
        }
        applyFetchFailureState(setInfluencers, setListMeta, setLoadError, msg)
      } finally {
        setLoading(false)
      }
    },
    [hydrateInfluencers, logout],
  )

  // Load shared list when session changes
  useEffect(() => {
    if (!user) {
      setInfluencers([])
      setLoading(false)
      setLoadError(null)
      setListMeta(listMetaForFullClientList([]))
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        await hydrateInfluencers()
      } catch (e) {
        if (cancelled) return
        const msg = e?.message || 'Failed to load influencers'
        if (isUnauthorizedLoadError(msg)) {
          logout()
          return
        }
        applyFetchFailureState(setInfluencers, setListMeta, setLoadError, msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user?.id, hydrateInfluencers, logout])

  const addInfluencer = useCallback(async (data) => {
    const newId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const newInfluencer = {
      ...data,
      id: newId,
      workflowStatus: data.workflowStatus || 'New Lead',
      approvalStatus: data.approvalStatus || 'Pending',
      paymentStatus: data.paymentStatus || 'Not Requested',
      agreementStatus: data.agreementStatus || 'Not Generated',
      agreementGenerated: false, signedByInfluencer: false, signedByCompany: false,
      timeline: [{ event: 'Created', date: new Date().toISOString().split('T')[0], note: 'Added to system' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await createInfluencerApi(newInfluencer)
    await reloadFromServer()
    return newInfluencer.id
  }, [reloadFromServer])

  const updateInfluencer = useCallback(async (id, updates) => {
    const sid = String(id)
    const current = influencersRefGlobal.current.find((inf) => String(inf.id) === sid)
    const next = current
      ? { ...current, ...updates, id: current.id, updatedAt: new Date().toISOString() }
      : { ...updates, id: sid, updatedAt: new Date().toISOString() }
    const wasInList = !!influencersRefGlobal.current.find((inf) => String(inf.id) === sid)
    const data = await updateInfluencerApi(sid, next)
    if (data?.influencer) {
      if (wasInList) {
        setInfluencers((prev) => {
          const idx = prev.findIndex((inf) => String(inf.id) === sid)
          if (idx === -1) return prev
          const copy = [...prev]
          copy[idx] = data.influencer
          return copy
        })
      } else {
        await reloadFromServer()
      }
    } else {
      await reloadFromServer()
    }
  }, [reloadFromServer])

  const updateWorkflowStatus = useCallback(async (id, status, note = '') => {
    const sid = String(id)
    const current = influencersRefGlobal.current.find((inf) => String(inf.id) === sid)
    if (!current) return
    const entry = { event: status, date: new Date().toISOString().split('T')[0], note }
    const next = {
      ...current,
      workflowStatus: status,
      updatedAt: new Date().toISOString(),
      timeline: [...(current.timeline || []), entry],
    }
    const wasInList = !!influencersRefGlobal.current.find((inf) => String(inf.id) === sid)
    const data = await updateInfluencerApi(sid, next)
    if (data?.influencer) {
      if (wasInList) {
        setInfluencers((prev) => {
          const idx = prev.findIndex((inf) => String(inf.id) === sid)
          if (idx === -1) return prev
          const copy = [...prev]
          copy[idx] = data.influencer
          return copy
        })
      } else {
        await reloadFromServer()
      }
    } else {
      await reloadFromServer()
    }
  }, [reloadFromServer])

  const deleteInfluencer = useCallback(async (id) => {
    await deleteInfluencerApi(String(id))
    await reloadFromServer()
  }, [reloadFromServer])

  return (
    <InfluencersContext.Provider
      value={{
        influencers,
        loading,
        loadError,
        listMeta,
        retryLoad,
        reloadFromServer,
        refetchInfluencerPage,
        addInfluencer,
        updateInfluencer,
        updateWorkflowStatus,
        deleteInfluencer,
      }}
    >
      {children}
    </InfluencersContext.Provider>
  )
}

export function useInfluencers() {
  const ctx = useContext(InfluencersContext)
  if (!ctx) throw new Error('useInfluencers must be used within InfluencersProvider')
  return ctx
}
