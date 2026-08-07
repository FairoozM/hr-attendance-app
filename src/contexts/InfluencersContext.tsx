import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useAuth } from './AuthContext'
import {
  fetchInfluencersRaw,
  createInfluencer as createInfluencerApi,
  updateInfluencer as updateInfluencerApi,
  deleteInfluencer as deleteInfluencerApi,
  replaceInfluencersSnapshot,
  type Influencer,
} from '../lib/influencers'
import { normalizeInfluencerResponse } from '../lib/influencerResponse'
import { readLegacyInfluencersSnapshot, clearLegacyInfluencersSnapshot } from '../lib/legacyStorageMigration'
import type {
  InfluencerCreatePayload,
  InfluencerListMeta,
  InfluencerUpdatePayload,
} from '../types/influencer'

/** Synced from provider state for failure fallback (avoids stale closure). */
const influencersRefGlobal: { current: Influencer[] } = { current: [] }

type AuthUserLike = {
  role?: string
  permissions?: {
    influencers?: {
      manage?: boolean
      approve?: boolean
      payments?: boolean
      agreements?: boolean
    }
  }
}

type HydrateOptions = { page?: number; limit?: number }

type PageQuery = { page: number; limit: number }

/** Legacy browser-only store (before server sync). Migrated once if API returns empty. */
function loadLegacyLocal(): unknown {
  return readLegacyInfluencersSnapshot()
}

/** Merge server + old browser-only lists: same id keeps the row with newer updatedAt. */
function mergeInfluencerListsById(base: Influencer[] | null | undefined, extra: Influencer[] | null | undefined): Influencer[] {
  const ts = (r: Influencer) => {
    const u = r?.updatedAt || r?.createdAt
    const n = u ? new Date(u).getTime() : 0
    return Number.isNaN(n) ? 0 : n
  }
  const byId = new Map<string, Influencer>()
  for (const r of base || []) {
    if (r && r.id != null) byId.set(String(r.id), r)
  }
  for (const r of extra || []) {
    if (!r || r.id == null) continue
    const id = String(r.id)
    if (!byId.has(id)) {
      byId.set(id, r)
    } else if (ts(r) > ts(byId.get(id)!)) {
      byId.set(id, r)
    }
  }
  return Array.from(byId.values())
}

function canPersistInfluencersToServer(user: AuthUserLike | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'warehouse') return true
  const m = user.permissions?.influencers || {}
  return !!(m.manage || m.approve || m.payments || m.agreements)
}

function listMetaForFullClientList(list: Influencer[]): InfluencerListMeta {
  const n = list.length
  return {
    total: n,
    totalPages: 1,
    page: 1,
    limit: n || 10,
    isFullListClientPaging: true,
  }
}

function applyFetchFailureState(
  setInfluencers: Dispatch<SetStateAction<Influencer[]>>,
  setListMeta: Dispatch<SetStateAction<InfluencerListMeta>>,
  setLoadError: Dispatch<SetStateAction<string | null>>,
  errMessage: string,
) {
  setLoadError(errMessage)
  const legacy = loadLegacyLocal()
  const prev = influencersRefGlobal.current
  if (prev.length > 0) return
  if (Array.isArray(legacy) && legacy.length > 0) {
    setInfluencers(legacy as Influencer[])
    setListMeta(listMetaForFullClientList(legacy as Influencer[]))
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
] as const

export const APPROVAL_STATUSES = ['Pending', 'Shortlisted', 'Approved', 'Rejected'] as const
export const PAYMENT_STATUSES = [
  'Not Requested', 'Bank Details Pending', 'Ready for Payment', 'Payment Processing', 'Paid',
] as const
export const COLLABORATION_TYPES = [
  'Collaboration Post', 'Reel on Influencer Page', 'Story Only',
  'Reel + Story Package', 'Usage Rights Included', 'Custom',
] as const
export const CONTACT_STATUSES = [
  'Not Contacted', 'First Contact Made', 'In Discussion', 'Negotiating', 'Offer Shared', 'Deal Closed',
] as const
export const SHOOT_STATUSES = ['Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'Reschedule Needed'] as const
export const AGREEMENT_STATUSES = ['Not Generated', 'Generated', 'Sent', 'Signed', 'Expired'] as const
export const CURRENCIES = ['AED', 'USD', 'SAR', 'GBP', 'EUR'] as const

export interface InfluencersContextValue {
  influencers: Influencer[]
  loading: boolean
  loadError: string | null
  listMeta: InfluencerListMeta
  retryLoad: () => Promise<void>
  reloadFromServer: () => Promise<Influencer[] | null>
  refetchInfluencerPage: (next: Partial<PageQuery>) => Promise<void>
  addInfluencer: (data: InfluencerCreatePayload) => Promise<string>
  updateInfluencer: (
    id: string,
    updates: InfluencerUpdatePayload,
  ) => Promise<{ success?: boolean; influencer?: Influencer } | null>
  updateWorkflowStatus: (id: string, status: string, note?: string) => Promise<void>
  deleteInfluencer: (id: string) => Promise<void>
}

const InfluencersContext = createContext<InfluencersContextValue | null>(null)

function isUnauthorizedLoadError(message: string | undefined): boolean {
  const m = String(message || '')
  return m.includes('401') || m.toLowerCase().includes('unauthorized')
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return fallback
}

export function InfluencersProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const [influencers, setInfluencers] = useState<Influencer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [listMeta, setListMeta] = useState<InfluencerListMeta>(() => listMetaForFullClientList([]))
  const userRef = useRef(user)
  const serverPageQueryRef = useRef<PageQuery>({ page: 1, limit: 20 })

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    influencersRefGlobal.current = influencers
  }, [influencers])

  const hydrateInfluencers = useCallback(async (opts?: HydrateOptions): Promise<Influencer[]> => {
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

    const serverList = normalized.items
    const legacy = loadLegacyLocal()
    let list = serverList
    let hadLegacy = Array.isArray(legacy) && legacy.length > 0
    if (hadLegacy) {
      list = mergeInfluencerListsById(serverList, legacy as Influencer[])
    }
    const mergedDiffersFromServer =
      hadLegacy && JSON.stringify(list) !== JSON.stringify(serverList)

    let loadErr: string | null = null
    const u = userRef.current as AuthUserLike | null | undefined

    if (mergedDiffersFromServer && canPersistInfluencersToServer(u)) {
      try {
        await replaceInfluencersSnapshot(list)
        try {
          clearLegacyInfluencersSnapshot()
        } catch (_) {}
      } catch (putErr) {
        loadErr = errorMessage(putErr, 'Could not save merged influencers to the server')
        list = serverList
        hadLegacy = true
      }
    } else if (mergedDiffersFromServer && !canPersistInfluencersToServer(u)) {
      loadErr =
        'This browser had a local influencer list; it was merged for display only. Log in once with an account that can edit influencers (or admin) to upload it to the server.'
    } else if (hadLegacy && !mergedDiffersFromServer) {
      try {
        clearLegacyInfluencersSnapshot()
      } catch (_) {}
    }

    setInfluencers(list)
    setListMeta(listMetaForFullClientList(list))
    setLoadError(loadErr)
    return list
  }, [])

  const reloadFromServer = useCallback(async (): Promise<Influencer[] | null> => {
    try {
      return await hydrateInfluencers()
    } catch (e) {
      const msg = errorMessage(e, 'Failed to load influencers')
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
      const msg = errorMessage(e, 'Failed to load influencers')
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
    async (next: Partial<PageQuery>) => {
      serverPageQueryRef.current = { ...serverPageQueryRef.current, ...next }
      setLoading(true)
      setLoadError(null)
      try {
        await hydrateInfluencers(serverPageQueryRef.current)
      } catch (e) {
        const msg = errorMessage(e, 'Failed to load influencers')
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
        const msg = errorMessage(e, 'Failed to load influencers')
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

  const addInfluencer = useCallback(async (data: InfluencerCreatePayload): Promise<string> => {
    const newId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const newInfluencer: Influencer = {
      ...data,
      id: newId,
      name: data.name ?? '',
      workflowStatus: data.workflowStatus || 'New Lead',
      approvalStatus: data.approvalStatus || 'Pending',
      paymentStatus: data.paymentStatus || 'Not Requested',
      agreementStatus: data.agreementStatus || 'Not Generated',
      agreementGenerated: false,
      signedByInfluencer: false,
      signedByCompany: false,
      timeline: [{ event: 'Created', date: new Date().toISOString().split('T')[0], note: 'Added to system' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await createInfluencerApi(newInfluencer)
    await reloadFromServer()
    return newInfluencer.id
  }, [reloadFromServer])

  /**
   * Send ONLY the changed fields to the API. The backend is the source of truth and merges
   * with the stored row, so we MUST NOT splat the local row into the request — a stale local
   * row would silently overwrite fields that another action (or another tab) just changed.
   */
  const updateInfluencer = useCallback(async (id: string, updates: InfluencerUpdatePayload) => {
    const sid = String(id)
    const payload: InfluencerUpdatePayload = { ...updates, id: sid, updatedAt: new Date().toISOString() }
    const data = await updateInfluencerApi(sid, payload as Influencer)
    if (data?.influencer) {
      setInfluencers((prev) => {
        const idx = prev.findIndex((inf) => String(inf.id) === sid)
        if (idx === -1) {
          return [data.influencer!, ...prev]
        }
        const copy = [...prev]
        copy[idx] = data.influencer!
        return copy
      })
    } else {
      await reloadFromServer()
    }
    return data
  }, [reloadFromServer])

  const updateWorkflowStatus = useCallback(async (id: string, status: string, note = '') => {
    const sid = String(id)
    const current = influencersRefGlobal.current.find((inf) => String(inf.id) === sid)
    const entry = { event: status, date: new Date().toISOString().split('T')[0], note }
    /** Send only the diff + appended timeline entry; backend merges with the stored row. */
    const payload: InfluencerUpdatePayload = {
      id: sid,
      workflowStatus: status,
      updatedAt: new Date().toISOString(),
      timelineAppend: entry,
      timeline: [...(current?.timeline || []), entry],
    }
    const data = await updateInfluencerApi(sid, payload as Influencer)
    if (data?.influencer) {
      setInfluencers((prev) => {
        const idx = prev.findIndex((inf) => String(inf.id) === sid)
        if (idx === -1) return [data.influencer!, ...prev]
        const copy = [...prev]
        copy[idx] = data.influencer!
        return copy
      })
    } else {
      await reloadFromServer()
    }
  }, [reloadFromServer])

  const deleteInfluencer = useCallback(async (id: string) => {
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

export function useInfluencers(): InfluencersContextValue {
  const ctx = useContext(InfluencersContext)
  if (!ctx) throw new Error('useInfluencers must be used within InfluencersProvider')
  return ctx
}
