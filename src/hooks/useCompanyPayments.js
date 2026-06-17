import { useState, useCallback, useEffect, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { PAYMENT_STATUS, DEFAULT_INFORM_ASAD_BEFORE_DAYS } from '../data/paymentTypes'
import { getInformAsadDate, getDaysLeft } from '../utils/paymentUtils'

const STORAGE_KEY = 'hr_company_payments_v1'

/**
 * @typedef {object} HistoryEntry
 * @property {string} id
 * @property {string} action
 * @property {string} [fromStatus]
 * @property {string} [toStatus]
 * @property {string} [note]
 * @property {string} performedBy
 * @property {string} performedAt
 */

/**
 * @typedef {object} FileAttachment
 * @property {string} id
 * @property {string} name
 * @property {string} mime
 * @property {string} dataUrl
 */

/**
 * @typedef {object} CompanyPayment
 * @property {string} id
 * @property {string} title
 * @property {string} paymentType
 * @property {string} sourceModule
 * @property {string} [sourceReferenceId]
 * @property {number|null} [amount]
 * @property {string} currency
 * @property {string} company
 * @property {string} dueDate
 * @property {number} informAsadBeforeDays
 * @property {string} informAsadDate
 * @property {string} [payeeOrVendor]
 * @property {string} [responsiblePerson]
 * @property {string} status
 * @property {string} priority
 * @property {string} notes
 * @property {FileAttachment[]} [attachments]
 * @property {string} createdBy
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} [informedToAsadAt]
 * @property {string|null} [informedToAsadBy]
 * @property {string|null} [paymentDoneAt]
 * @property {string|null} [paymentDoneBy]
 * @property {FileAttachment|null} [paymentProofAttachment]
 * @property {HistoryEntry[]} [history]
 */

function uid() {
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function nowIso() {
  return new Date().toISOString()
}

function getActor(user) {
  if (!user) return 'system'
  return user.employee?.full_name || user.username || user.email || 'user'
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const p = JSON.parse(raw)
    return Array.isArray(p) ? p : []
  } catch {
    return []
  }
}

function saveToStorage(rows) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  } catch (e) {
    console.error('[company-payments] save failed', e)
  }
}

function pushHistory(payment, entry) {
  const h = Array.isArray(payment.history) ? payment.history : []
  return [...h, { id: uid(), ...entry }]
}

/** Ensure computed inform date exists */
function normalizeRow(row) {
  const inform = row.informAsadDate || getInformAsadDate(row.dueDate, row.informAsadBeforeDays)
  return { ...row, informAsadDate: inform }
}

const DEMO = [
  {
    id: uid(),
    title: 'VAT — Q1 filing (KSA)',
    paymentType: 'Tax / VAT',
    sourceModule: 'Manual',
    sourceReferenceId: '',
    amount: 12500,
    currency: 'SAR',
    company: 'KSA',
    dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    informAsadBeforeDays: DEFAULT_INFORM_ASAD_BEFORE_DAYS,
    informAsadDate: getInformAsadDate(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), 5),
    payeeOrVendor: 'ZATCA / Tax authority',
    responsiblePerson: 'Accounts',
    status: PAYMENT_STATUS.PAYMENT_NEEDED,
    priority: 'high',
    notes: 'From main shop; inform Asad before transfer.',
    attachments: [],
    createdBy: 'demo',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    informedToAsadAt: null,
    informedToAsadBy: null,
    paymentDoneAt: null,
    paymentDoneBy: null,
    paymentProofAttachment: null,
    history: [],
  },
  {
    id: uid(),
    title: 'Office utilities — April',
    paymentType: 'Utility Bill',
    sourceModule: 'Bills',
    sourceReferenceId: 'BILL-2026-04',
    amount: 2400,
    currency: 'AED',
    company: 'Main Shop (UAE)',
    dueDate: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
    informAsadBeforeDays: DEFAULT_INFORM_ASAD_BEFORE_DAYS,
    informAsadDate: getInformAsadDate(new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10), 5),
    payeeOrVendor: 'DEWA / utilities',
    responsiblePerson: 'Admin',
    status: PAYMENT_STATUS.INFORMED_TO_ASAD,
    priority: 'medium',
    notes: '',
    attachments: [],
    createdBy: 'demo',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    informedToAsadAt: new Date().toISOString(),
    informedToAsadBy: 'demo',
    paymentDoneAt: null,
    paymentDoneBy: null,
    paymentProofAttachment: null,
    history: [
      {
        id: uid(),
        action: 'informed',
        fromStatus: PAYMENT_STATUS.PAYMENT_NEEDED,
        toStatus: PAYMENT_STATUS.INFORMED_TO_ASAD,
        note: '',
        performedBy: 'demo',
        performedAt: new Date().toISOString(),
      },
    ],
  },
]

export function useCompanyPayments() {
  const { user } = useAuth()
  const [rows, setRows] = useState(() => {
    const loaded = loadFromStorage()
    if (loaded.length) return loaded.map(normalizeRow)
    saveToStorage(DEMO.map(normalizeRow))
    return DEMO.map(normalizeRow)
  })

  useEffect(() => {
    saveToStorage(rows)
  }, [rows])

  const actor = useMemo(() => getActor(user), [user])

  const addPayment = useCallback(
    (raw) => {
      const id = raw.id && String(raw.id).trim() ? raw.id : uid()
      const due = String(raw.dueDate || '').slice(0, 10)
      const before = Number.isFinite(raw.informAsadBeforeDays)
        ? raw.informAsadBeforeDays
        : DEFAULT_INFORM_ASAD_BEFORE_DAYS
      const record = normalizeRow({
        id,
        title: String(raw.title || '').trim() || 'Payment',
        paymentType: String(raw.paymentType || 'Other'),
        sourceModule: String(raw.sourceModule || 'Manual'),
        sourceReferenceId: raw.sourceReferenceId != null ? String(raw.sourceReferenceId) : '',
        amount: raw.amount != null && raw.amount !== '' ? Number(raw.amount) : null,
        currency: String(raw.currency || 'AED'),
        company: String(raw.company || 'Main Shop (UAE)'),
        dueDate: due,
        informAsadBeforeDays: before,
        payeeOrVendor: String(raw.payeeOrVendor || '').trim(),
        responsiblePerson: String(raw.responsiblePerson || '').trim(),
        status: raw.status || PAYMENT_STATUS.PAYMENT_NEEDED,
        priority: String(raw.priority || 'medium'),
        notes: String(raw.notes || ''),
        attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
        createdBy: actor,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        informedToAsadAt: raw.informedToAsadAt || null,
        informedToAsadBy: raw.informedToAsadBy || null,
        paymentDoneAt: raw.paymentDoneAt || null,
        paymentDoneBy: raw.paymentDoneBy || null,
        paymentProofAttachment: raw.paymentProofAttachment || null,
        history: [
          {
            id: uid(),
            action: 'created',
            fromStatus: '',
            toStatus: raw.status || PAYMENT_STATUS.PAYMENT_NEEDED,
            note: 'Record created',
            performedBy: actor,
            performedAt: nowIso(),
          },
        ],
      })
      setRows((prev) => [...prev, record])
      return record
    },
    [actor]
  )

  const updatePayment = useCallback(
    (id, raw) => {
      setRows((prev) => {
        const i = prev.findIndex((p) => p.id === id)
        if (i < 0) return prev
        const cur = prev[i]
        const before = raw.informAsadBeforeDays != null
          ? raw.informAsadBeforeDays
          : cur.informAsadBeforeDays
        const merged = normalizeRow({
          ...cur,
          ...raw,
          id: cur.id,
          informAsadBeforeDays: before,
          updatedAt: nowIso(),
          createdBy: cur.createdBy,
          createdAt: cur.createdAt,
        })
        delete merged._historyNote
        if (raw.status && raw.status !== cur.status) {
          merged.history = pushHistory(cur, {
            action: 'status_changed',
            fromStatus: cur.status,
            toStatus: raw.status,
            note: raw._historyNote || 'Updated',
            performedBy: actor,
            performedAt: nowIso(),
          })
        }
        const next = [...prev]
        next[i] = merged
        return next
      })
    },
    [actor]
  )

  const markInformedToAsad = useCallback(
    (id, note = '') => {
      setRows((prev) => {
        const i = prev.findIndex((p) => p.id === id)
        if (i < 0) return prev
        const cur = prev[i]
        if (cur.status === PAYMENT_STATUS.PAYMENT_DONE) return prev
        const nextS = PAYMENT_STATUS.INFORMED_TO_ASAD
        const t = nowIso()
        const merged = {
          ...cur,
          status: nextS,
          informedToAsadAt: t,
          informedToAsadBy: actor,
          updatedAt: t,
          history: pushHistory(cur, {
            action: 'informed',
            fromStatus: cur.status,
            toStatus: nextS,
            note: String(note || ''),
            performedBy: actor,
            performedAt: t,
          }),
        }
        const n = [...prev]
        n[i] = merged
        return n
      })
    },
    [actor]
  )

  const markPaymentDone = useCallback(
    (id, proof, note = '') => {
      setRows((prev) => {
        const i = prev.findIndex((p) => p.id === id)
        if (i < 0) return prev
        const cur = prev[i]
        const t = nowIso()
        const nextS = PAYMENT_STATUS.PAYMENT_DONE
        const merged = {
          ...cur,
          status: nextS,
          paymentDoneAt: t,
          paymentDoneBy: actor,
          paymentProofAttachment: proof || cur.paymentProofAttachment || null,
          updatedAt: t,
          history: pushHistory(cur, {
            action: 'payment_done',
            fromStatus: cur.status,
            toStatus: nextS,
            note: String(note || ''),
            performedBy: actor,
            performedAt: t,
          }),
        }
        const n = [...prev]
        n[i] = merged
        return n
      })
    },
    [actor]
  )

  const addAttachment = useCallback((id, file) => {
    if (!file) return
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onerror = () => reject(new Error('Read failed'))
      r.onload = () => {
        const dataUrl = typeof r.result === 'string' ? r.result : ''
        const att = { id: uid(), name: file.name, mime: file.type, dataUrl }
        setRows((prev) => {
          const i = prev.findIndex((p) => p.id === id)
          if (i < 0) return prev
          const cur = prev[i]
          const atts = Array.isArray(cur.attachments) ? cur.attachments : []
          const t = nowIso()
          const merged = {
            ...cur,
            attachments: [...atts, att],
            updatedAt: t,
            history: pushHistory(cur, {
              action: 'attachment_added',
              fromStatus: cur.status,
              toStatus: cur.status,
              note: att.name,
              performedBy: actor,
              performedAt: t,
            }),
          }
          const n = [...prev]
          n[i] = merged
          resolve(merged)
          return n
        })
      }
      r.readAsDataURL(file)
    })
  }, [actor])

  const removePayment = useCallback((id) => {
    setRows((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const setPaymentProof = useCallback(
    (id, file) => {
      if (!file) return Promise.resolve()
      return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onerror = () => reject(new Error('Read failed'))
        r.onload = () => {
          const dataUrl = typeof r.result === 'string' ? r.result : ''
          const att = { id: uid(), name: file.name, mime: file.type, dataUrl }
          setRows((prev) => {
            const i = prev.findIndex((p) => p.id === id)
            if (i < 0) return prev
            const cur = prev[i]
            const t = nowIso()
            const merged = {
              ...cur,
              paymentProofAttachment: att,
              updatedAt: t,
              history: pushHistory(cur, {
                action: 'proof_uploaded',
                fromStatus: cur.status,
                toStatus: cur.status,
                note: 'Payment proof attached',
                performedBy: actor,
                performedAt: t,
              }),
            }
            const n = [...prev]
            n[i] = merged
            resolve(merged)
            return n
          })
        }
        r.readAsDataURL(file)
      })
    },
    [actor]
  )

  return {
    payments: rows,
    addPayment,
    updatePayment,
    markInformedToAsad,
    markPaymentDone,
    addAttachment,
    setPaymentProof,
    removePayment,
    getDaysLeft,
  }
}
