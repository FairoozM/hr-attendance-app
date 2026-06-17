/**
 * User-facing labels for annual leave. Backend `status` / `shop_visit_status` values are unchanged.
 */

/** Human-readable combined workflow label (leave + main shop). */
export function shopWorkflowLabel(row) {
  if (row.status === 'Pending') return 'Pending leave approval'
  if (row.status === 'Rejected') return 'Rejected'
  if (row.status !== 'Approved') return row.status || '—'
  const sv = row.shop_visit_status
  if (!sv || sv === 'PendingSubmission') return 'Shop visit: waiting for employee'
  switch (sv) {
    case 'Submitted':
      return 'Shop visit: submitted'
    case 'Confirmed':
      return 'Shop visit confirmed'
    case 'MoneyCalculated':
      return 'Calculator applied to visit'
    case 'Completed':
      return 'Shop visit completed'
    case 'Cancelled':
      return 'Shop visit cancelled'
    default:
      return sv || '—'
  }
}

const LEAVE_EFFECTIVE = {
  Pending: 'Pending approval',
  Approved: 'Approved (upcoming)',
  Rejected: 'Rejected',
  Ongoing: 'Employee on leave',
  ReturnPending: 'Return pending',
  Overstayed: 'Overstayed',
  Completed: 'Leave completed',
}

export function leaveStatusDisplay(effectiveOrStatus) {
  const s = String(effectiveOrStatus || 'Pending')
  return LEAVE_EFFECTIVE[s] || s
}

export const SHOP_WORKFLOW_STEPS = [
  { id: 0, label: 'Waiting for employee', sub: 'Submit main shop visit' },
  { id: 1, label: 'Visit submitted', sub: 'Date/time set' },
  { id: 2, label: 'Shop visit confirmed', sub: 'By HR' },
  { id: 3, label: 'Calculator applied', sub: 'From Leave Salary Calculator' },
  { id: 4, label: 'Shop visit completed', sub: 'Passport / money' },
]

/**
 * @returns {number} active index 0..4 (or -1 if cancelled / not applicable)
 */
export function shopVisitStepperIndex(shopStatus, leaveStatus) {
  if (leaveStatus !== 'Approved') return -1
  const sv = shopStatus || 'PendingSubmission'
  if (sv === 'Cancelled') return -1
  const order = {
    PendingSubmission: 0,
    Submitted: 1,
    Confirmed: 2,
    MoneyCalculated: 3,
    Completed: 4,
  }
  return order[sv] ?? 0
}

export const LEAVE_REQUEST_STEPS = [
  { id: 0, label: 'Applied' },
  { id: 1, label: 'Approved or rejected' },
  { id: 2, label: 'On leave' },
  { id: 3, label: 'Return pending' },
  { id: 4, label: 'Leave completed' },
]

export function leaveRequestStepperIndex(effective) {
  const e = String(effective || 'Pending')
  if (e === 'Rejected') return 1
  if (e === 'Pending') return 0
  if (e === 'Approved') return 1
  if (e === 'Ongoing') return 2
  if (e === 'ReturnPending' || e === 'Overstayed') return 3
  if (e === 'Completed') return 4
  return 0
}

export function nextShopActionHint(row) {
  if (row.status !== 'Approved') return 'Approve the leave first.'
  if (row.shop_visit_status === 'PendingSubmission' || !row.shop_visit_status) {
    return 'Next: employee must submit a main shop visit date and time.'
  }
  if (row.shop_visit_status === 'Submitted') return 'Next: HR may confirm the visit, or reschedule.'
  if (row.shop_visit_status === 'Confirmed' && row.calculated_leave_amount == null) {
    return 'Next: save a calculation in Leave Salary Calculator, then use Apply salary calculator in this request.'
  }
  if (row.shop_visit_status === 'MoneyCalculated' || (row.shop_visit_status === 'Confirmed' && row.calculated_leave_amount != null)) {
    return 'Next: when passport/money is handed over, mark shop visit completed.'
  }
  if (row.shop_visit_status === 'Completed') {
    return 'Main shop visit workflow is finished.'
  }
  return 'See current status for the next action.'
}
