import type { NotificationItem } from '../../types/notifications'
import { isDocumentReminder } from '../../types/notifications'

const DOCUMENT_EXPIRY_ROUTE = '/management/document-expiry'
const SUBSCRIPTIONS_ROUTE = '/management/subscriptions'
const ANNUAL_LEAVE_ROUTE = '/annual-leave'

const ISO_QMS_ROUTES: Record<string, string> = {
  iso_qms_document_review: '/iso-qms/documents?reviewDue=true',
  iso_qms_document_approval: '/iso-qms/documents?status=Under%20Review',
  iso_qms_document_expiry: '/iso-qms/documents',
  iso_qms_certificate_expiry: '/iso-qms/certificates?status=Expired',
  iso_qms_calibration_due: '/iso-qms/calibration?upcoming=true',
  iso_qms_audit_upcoming: '/iso-qms/audits?upcoming=true',
  iso_qms_corrective_action_due: '/iso-qms/findings?overdue=true',
  iso_qms_risk_action: '/iso-qms/risks?status=Open',
  iso_qms_management_review: '/iso-qms/management-reviews?upcoming=true',
  iso_qms_finding: '/iso-qms/findings',
}

/** Where the "View" action should take the user for a given notification. */
export function notificationRoute(item: NotificationItem): string {
  if (isDocumentReminder(item)) return DOCUMENT_EXPIRY_ROUTE
  const type = String(item.type || '')
  if (type.startsWith('subscription_')) return SUBSCRIPTIONS_ROUTE
  if (type.startsWith('shop_visit')) return ANNUAL_LEAVE_ROUTE
  if (type.startsWith('iso_qms')) {
    return ISO_QMS_ROUTES[type] || '/iso-qms/dashboard'
  }
  return DOCUMENT_EXPIRY_ROUTE
}
