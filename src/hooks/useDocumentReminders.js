import { useMemo } from 'react'
import { getDaysLeft, getReminderDate, getSmartStatus } from '../pages/management/utils/docExpiryUtils'

/**
 * Derives synthetic reminder notifications from a list of document records.
 *
 * A reminder fires when today >= reminderDate (i.e. daysUntilReminder <= 0)
 * AND the document is not already Expired (those get their own Expired label).
 *
 * Returns an array of notification-shaped objects:
 *   { id, title, message, scheduled_for, is_read: false, _isDocReminder: true, _urgency }
 *
 * API integration point: replace the `documents` parameter with data fetched
 * from your backend once the document model is persisted server-side.
 */
export function useDocumentReminders(documents) {
  return useMemo(() => {
    if (!Array.isArray(documents)) return []

    const reminders = []
    for (const doc of documents) {
      const reminderDate = getReminderDate(doc.expiryDate, doc.reminderDays)
      if (!reminderDate) continue

      const daysUntilReminder = getDaysLeft(reminderDate)
      // Only fire once the reminder window has opened (today >= reminderDate)
      if (daysUntilReminder > 0) continue

      const status = getSmartStatus(doc.expiryDate)
      const daysLeft = getDaysLeft(doc.expiryDate)

      let urgency = 'due-soon'
      if (status === 'Expired')  urgency = 'expired'
      else if (status === 'Urgent') urgency = 'urgent'

      let message = ''
      if (status === 'Expired') {
        message = `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''} ago — action required.`
      } else if (daysLeft === 0) {
        message = 'Expires today — immediate action required.'
      } else {
        message = `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} on ${new Date(doc.expiryDate).toLocaleDateString('en-GB')}.`
      }

      reminders.push({
        id: `doc-reminder-${doc.id}`,
        title: doc.name,
        message,
        scheduled_for: doc.expiryDate,
        is_read: false,
        _isDocReminder: true,
        _urgency: urgency,
        _docType: doc.documentType || '',
        _company: doc.company || '',
      })
    }

    // Sort: expired first, then urgent, then due-soon
    const order = { expired: 0, urgent: 1, 'due-soon': 2 }
    reminders.sort((a, b) => (order[a._urgency] ?? 3) - (order[b._urgency] ?? 3))
    return reminders
  }, [documents])
}
