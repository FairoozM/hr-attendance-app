const documentExpiryService = require('./documentExpiryService')
const notificationActionsService = require('./notificationActionsService')

const SOURCE_TYPE = 'document_expiry'

function docTypeSlug(documentType) {
  const raw = String(documentType || 'document').trim().toLowerCase()
  if (!raw) return 'document'
  if (raw.includes('trade license')) return 'trade_license'
  if (raw.includes('visa') || raw.includes('emirates')) return 'visa_emirates_id'
  if (raw.includes('vat')) return 'vat_filing'
  if (raw.includes('insurance')) return 'insurance'
  if (raw.includes('nicop') || raw.includes('id /')) return 'id_document'
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'document'
}

function buildNotificationKey(doc) {
  const expiry = String(doc.expiry_date || '').slice(0, 10)
  const typeSlug = docTypeSlug(doc.document_type)
  return `document_expiry:${typeSlug}:${doc.id}:${expiry}`
}

function getDaysLeft(expiryDate) {
  if (!expiryDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(expiryDate)
  exp.setHours(0, 0, 0, 0)
  return Math.ceil((exp - today) / (1000 * 60 * 60 * 24))
}

function getReminderDate(expiryDate, reminderDays) {
  if (!expiryDate || reminderDays == null) return null
  const exp = new Date(expiryDate)
  exp.setDate(exp.getDate() - Number(reminderDays))
  return exp.toISOString().slice(0, 10)
}

function getSmartStatus(expiryDate) {
  const days = getDaysLeft(expiryDate)
  if (days === null) return 'OK'
  if (days < 0) return 'Expired'
  if (days <= 7) return 'Urgent'
  if (days <= 30) return 'Due Soon'
  return 'OK'
}

function buildMessage(expiryDate) {
  const status = getSmartStatus(expiryDate)
  const daysLeft = getDaysLeft(expiryDate)
  if (status === 'Expired') {
    const n = Math.abs(daysLeft)
    return `Expired ${n} day${n !== 1 ? 's' : ''} ago — action required.`
  }
  if (daysLeft === 0) return 'Expires today — immediate action required.'
  const formatted = new Date(expiryDate).toLocaleDateString('en-GB')
  return `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} on ${formatted}.`
}

function mapUrgency(expiryDate) {
  const status = getSmartStatus(expiryDate)
  if (status === 'Expired') return 'expired'
  if (status === 'Urgent') return 'urgent'
  return 'due-soon'
}

function mapRow(doc, action) {
  const expiryDate = String(doc.expiry_date || '').slice(0, 10)
  const notificationKey = buildNotificationKey(doc)
  return {
    id: notificationKey,
    notification_key: notificationKey,
    type: 'document_expiry',
    title: doc.name,
    message: buildMessage(expiryDate),
    scheduled_for: expiryDate,
    is_read: false,
    source_type: SOURCE_TYPE,
    source_id: String(doc.id),
    due_date: expiryDate,
    document_type: doc.document_type || '',
    company: doc.company || '',
    urgency: mapUrgency(expiryDate),
    action_status: action?.status || 'active',
    snoozed_until: action?.snoozed_until ? String(action.snoozed_until).slice(0, 10) : null,
    _isDocReminder: true,
  }
}

async function listVisibleReminders() {
  const docs = await documentExpiryService.findAll()
  const candidates = []

  for (const doc of docs) {
    const expiryDate = doc.expiry_date
    if (!expiryDate) continue
    const reminderDate = getReminderDate(expiryDate, doc.reminder_days)
    if (!reminderDate) continue
    const daysUntilReminder = getDaysLeft(reminderDate)
    if (daysUntilReminder > 0) continue
    candidates.push(doc)
  }

  const keys = candidates.map(buildNotificationKey)
  const actions = await notificationActionsService.findByKeys(keys)

  const visible = []
  for (const doc of candidates) {
    const key = buildNotificationKey(doc)
    const action = actions.get(key)
    if (!notificationActionsService.isActionVisible(action)) continue
    visible.push(mapRow(doc, action))
  }

  const order = { expired: 0, urgent: 1, 'due-soon': 2 }
  visible.sort((a, b) => (order[a.urgency] ?? 3) - (order[b.urgency] ?? 3))
  return visible
}

async function unreadCount() {
  const rows = await listVisibleReminders()
  return rows.length
}

module.exports = {
  SOURCE_TYPE,
  buildNotificationKey,
  docTypeSlug,
  listVisibleReminders,
  unreadCount,
}
