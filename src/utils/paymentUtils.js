/**
 * Company payments — dates, status labels, urgency, and future integration helpers.
 */

import {
  PAYMENT_STATUS,
  DEFAULT_INFORM_ASAD_BEFORE_DAYS,
} from '../data/paymentTypes'

/** @param {string|Date|null|undefined} due */
function toDayStart(due) {
  if (due == null || due === '') return null
  const d = due instanceof Date ? new Date(due) : new Date(String(due))
  if (Number.isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d
}

function todayStart() {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return t
}

/**
 * Full calendar days from today until the given date (can be negative if past).
 * @param {string|Date|null|undefined} dueDate ISO date or YYYY-MM-DD
 * @returns {number|null}
 */
export function getDaysLeft(dueDate) {
  const target = toDayStart(dueDate)
  if (!target) return null
  const diff = target.getTime() - todayStart().getTime()
  return Math.round(diff / 86400000)
}

/**
 * The date by which Asad should be informed (inclusive of business rule).
 * @param {string|Date|null|undefined} dueDate
 * @param {number} [informAsadBeforeDays=5]
 * @returns {string|null} YYYY-MM-DD
 */
export function getInformAsadDate(dueDate, informAsadBeforeDays = DEFAULT_INFORM_ASAD_BEFORE_DAYS) {
  const due = toDayStart(dueDate)
  if (!due) return null
  const n = Number.isFinite(informAsadBeforeDays) ? informAsadBeforeDays : DEFAULT_INFORM_ASAD_BEFORE_DAYS
  const d = new Date(due)
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const URGENCY = {
  DONE: { key: 'done', label: 'Done', color: 'var(--success, #22c55e)' },
  OVERDUE: { key: 'overdue', label: 'Overdue', color: 'var(--danger, #ef4444)' },
  DUE_TODAY: { key: 'due_today', label: 'Due today', color: 'var(--warning, #f59e0b)' },
  INFORM_ASAD_TODAY: { key: 'inform_today', label: 'Inform Asad today', color: '#8b5cf6' },
  NEED_TO_INFORM: { key: 'need_inform', label: 'Need to inform Asad', color: '#ec4899' },
  DUE_SOON: { key: 'due_soon', label: 'Due soon', color: '#0ea5e9' },
  NORMAL: { key: 'normal', label: 'Normal', color: 'var(--text-muted, #94a3b8)' },
}

/**
 * Urgency for list badges (active payments; completed are always "Done").
 * @param {import('../hooks/useCompanyPayments').CompanyPayment} payment
 */
export function getPaymentUrgency(payment) {
  if (!payment) return URGENCY.NORMAL
  if (payment.status === PAYMENT_STATUS.PAYMENT_DONE) return URGENCY.DONE

  const dueLeft = getDaysLeft(payment.dueDate)
  const inform = payment.informAsadDate || getInformAsadDate(payment.dueDate, payment.informAsadBeforeDays)
  const informLeft = getDaysLeft(inform)

  if (dueLeft != null && dueLeft < 0) return URGENCY.OVERDUE
  if (dueLeft === 0) return URGENCY.DUE_TODAY

  if (payment.status === PAYMENT_STATUS.PAYMENT_NEEDED) {
    if (informLeft != null && informLeft < 0) return URGENCY.NEED_TO_INFORM
    if (informLeft === 0) return URGENCY.INFORM_ASAD_TODAY
  }

  if (dueLeft != null && dueLeft > 0 && dueLeft <= 7) return URGENCY.DUE_SOON
  return URGENCY.NORMAL
}

const STATUS_LABELS = {
  [PAYMENT_STATUS.PAYMENT_NEEDED]: 'Payment needed',
  [PAYMENT_STATUS.INFORMED_TO_ASAD]: 'Informed to Asad',
  [PAYMENT_STATUS.PAYMENT_DONE]: 'Payment done',
}

const STATUS_COLORS = {
  [PAYMENT_STATUS.PAYMENT_NEEDED]: '#f59e0b',
  [PAYMENT_STATUS.INFORMED_TO_ASAD]: '#8b5cf6',
  [PAYMENT_STATUS.PAYMENT_DONE]: '#22c55e',
}

export function getPaymentStatusLabel(status) {
  return STATUS_LABELS[status] || String(status || '')
}

export function getPaymentStatusColor(status) {
  return STATUS_COLORS[status] || 'var(--text-muted)'
}

/**
 * Sort: overdue & urgent active first; completed last.
 * @param {import('../hooks/useCompanyPayments').CompanyPayment[]} list
 */
export function sortPaymentsForDisplay(list) {
  const copy = [...(list || [])]
  return copy.sort((a, b) => {
    const aDone = a.status === PAYMENT_STATUS.PAYMENT_DONE ? 1 : 0
    const bDone = b.status === PAYMENT_STATUS.PAYMENT_DONE ? 1 : 0
    if (aDone !== bDone) return aDone - bDone

    const aU = getPaymentUrgency(a)
    const bU = getPaymentUrgency(b)
    const order = { overdue: 0, due_today: 1, need_inform: 2, inform_today: 3, due_soon: 4, normal: 5, done: 6 }
    const ao = order[aU.key] ?? 99
    const bo = order[bU.key] ?? 99
    if (ao !== bo) return ao - bo

    const aDue = a.dueDate || ''
    const bDue = b.dueDate || ''
    if (aDue !== bDue) return aDue.localeCompare(bDue)
    return (a.title || '').localeCompare(b.title || '')
  })
}

/**
 * For integration: build a record when Annual Leave approves a salary payout.
 * @param {{
 *   sourceReferenceId: string,
 *   title?: string,
 *   employeeName: string,
 *   dueDate: string,
 *   amount?: number|null,
 *   currency?: string,
 *   company?: string,
 *   notes?: string,
 * }} p
 * @returns {Omit<import('../hooks/useCompanyPayments').CompanyPayment, 'id'|'createdAt'|'updatedAt'|'history'|'createdBy'|'informAsadDate'> & { informAsadDate: string }}
 */
export function buildAnnualLeavePaymentPayload({
  sourceReferenceId,
  employeeName,
  dueDate,
  title,
  amount = null,
  currency = 'AED',
  company = 'Main Shop (UAE)',
  notes = '',
}) {
  const t = title || `Annual leave salary — ${employeeName}`
  return {
    title: t,
    paymentType: 'Annual Leave Salary',
    sourceModule: 'Annual Leave',
    sourceReferenceId: String(sourceReferenceId),
    amount: amount != null && Number.isFinite(Number(amount)) ? Number(amount) : null,
    currency: String(currency || 'AED'),
    company,
    dueDate: String(dueDate).slice(0, 10),
    informAsadBeforeDays: DEFAULT_INFORM_ASAD_BEFORE_DAYS,
    informAsadDate: getInformAsadDate(dueDate, DEFAULT_INFORM_ASAD_BEFORE_DAYS),
    payeeOrVendor: employeeName,
    responsiblePerson: '',
    status: PAYMENT_STATUS.PAYMENT_NEEDED,
    priority: 'high',
    notes: notes || '',
    attachments: [],
    informedToAsadAt: null,
    informedToAsadBy: null,
    paymentDoneAt: null,
    paymentDoneBy: null,
    paymentProofAttachment: null,
  }
}
