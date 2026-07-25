import type { NotificationItem } from '../../types/notifications'
import { isDocumentReminder } from '../../types/notifications'

const DOCUMENT_EXPIRY_ROUTE = '/management/document-expiry'
const SUBSCRIPTIONS_ROUTE = '/management/subscriptions'
const ANNUAL_LEAVE_ROUTE = '/annual-leave'

/** Where the "View" action should take the user for a given notification. */
export function notificationRoute(item: NotificationItem): string {
  if (isDocumentReminder(item)) return DOCUMENT_EXPIRY_ROUTE
  const type = String(item.type || '')
  if (type.startsWith('subscription_')) return SUBSCRIPTIONS_ROUTE
  if (type.startsWith('shop_visit')) return ANNUAL_LEAVE_ROUTE
  return DOCUMENT_EXPIRY_ROUTE
}
