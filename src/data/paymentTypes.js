/**
 * Company payments workflow — categories, companies, and source modules.
 * Other app sections (Annual Leave, Expiry, etc.) should import these for consistency.
 */

export const PAYMENT_STATUS = {
  PAYMENT_NEEDED: 'PAYMENT_NEEDED',
  INFORMED_TO_ASAD: 'INFORMED_TO_ASAD',
  PAYMENT_DONE: 'PAYMENT_DONE',
}

export const PAYMENT_TYPE_OPTIONS = [
  'Annual Leave Salary',
  'Tax / VAT',
  'Utility Bill',
  'Subscription',
  'License Renewal',
  'Supplier Payment',
  'Admin Payment',
  'Other',
]

export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

/** Companies — extend as your org grows */
export const COMPANY_OPTIONS = [
  'Main Shop (UAE)',
  'KSA',
  'E-Commerce / Exports',
  'Other',
]

/** Modules that can push payment records into the Payments hub. */
export const SOURCE_MODULE_OPTIONS = [
  { value: 'Manual', label: 'Manual' },
  { value: 'Annual Leave', label: 'Annual Leave' },
  { value: 'Expiry Tracker', label: 'Expiry Tracker' },
  { value: 'Bills', label: 'Bills' },
  { value: 'Other', label: 'Other' },
]

/** Default: Mr. Asad should be informed this many days before the payment due date */
export const DEFAULT_INFORM_ASAD_BEFORE_DAYS = 5
