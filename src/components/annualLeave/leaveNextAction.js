import { fmtDMY } from '../../utils/dateFormat'
import { alDaysBetween } from '../../utils/annualLeaveUtils'

export const NA = {
  APPROVE: 'approve',
  REJECT: 'reject',
  EMPLOYEE_SHOP: 'employee_shop',
  CONFIRM_SHOP: 'confirm_shop',
  RESCHEDULE_SHOP: 'reschedule_shop',
  APPLY_SALARY: 'apply_salary',
  MARK_SHOP_DONE: 'mark_shop_done',
  RETURN: 'confirm_return',
  EXTEND: 'extend',
  EDIT: 'edit',
}

/**
 * @returns {{ message: string, primaryId: string|null, primaryLabel: string|undefined, secondary: Array<{ id: string, label: string }> }}
 */
export function getNextAction(row, { isAdmin, isEmployee }) {
  const st = row.status
  const es = row.effective_status || st

  if (st === 'Rejected') {
    return { message: 'This request was not approved.', primaryId: null, secondary: [] }
  }

  if (st === 'Completed' || es === 'Completed') {
    return { message: 'This leave is complete.', primaryId: null, secondary: [] }
  }

  if (st === 'Pending') {
    if (isAdmin) {
      return {
        message: 'A decision is required for this request.',
        primaryId: NA.APPROVE,
        primaryLabel: 'Approve',
        secondary: [
          { id: NA.REJECT, label: 'Reject' },
          { id: NA.EDIT, label: 'Edit' },
        ],
      }
    }
    return { message: 'Your request is waiting for HR to approve or reject it.', primaryId: null, secondary: [] }
  }

  if (st === 'Approved') {
    const sv = row.shop_visit_status && String(row.shop_visit_status).trim() ? row.shop_visit_status : 'PendingSubmission'

    if (sv === 'Cancelled') {
      return { message: 'The main shop handover was cancelled for this leave.', primaryId: null, secondary: [] }
    }

    if (sv === 'PendingSubmission') {
      if (isEmployee) {
        return {
          message: 'Submit a date and time for your main shop visit (passport and pay).',
          primaryId: NA.EMPLOYEE_SHOP,
          primaryLabel: 'Submit shop visit',
          secondary: [],
        }
      }
      if (isAdmin) {
        return { message: 'Waiting for the employee to submit a main shop visit.', primaryId: null, secondary: [] }
      }
    }

    if (sv === 'Submitted') {
      if (isAdmin) {
        return {
          message: 'The visit was proposed. Confirm the slot or set a new one.',
          primaryId: NA.CONFIRM_SHOP,
          primaryLabel: 'Confirm visit',
          secondary: [
            { id: NA.RESCHEDULE_SHOP, label: 'Reschedule' },
          ],
        }
      }
      if (isEmployee) {
        return { message: 'Your proposed visit is waiting for HR to confirm.', primaryId: null, secondary: [] }
      }
    }

    if (sv === 'Confirmed' && row.calculated_leave_amount == null) {
      if (isAdmin) {
        return {
          message: 'The visit is confirmed. Link the leave salary to this handover when ready.',
          primaryId: NA.APPLY_SALARY,
          primaryLabel: 'Apply salary',
          secondary: [{ id: NA.RESCHEDULE_SHOP, label: 'Reschedule' }],
        }
      }
      return { message: 'The visit is confirmed. HR will apply the salary to this handover.', primaryId: null, secondary: [] }
    }

    if ((sv === 'MoneyCalculated' || (sv === 'Confirmed' && row.calculated_leave_amount != null)) && sv !== 'Completed') {
      if (isAdmin) {
        return {
          message: 'When passport and pay are given at the main shop, mark this handover done.',
          primaryId: NA.MARK_SHOP_DONE,
          primaryLabel: 'Mark handover done',
          secondary: [{ id: NA.RESCHEDULE_SHOP, label: 'Reschedule' }],
        }
      }
      return { message: 'Follow the agreed time for your main shop visit to collect your passport and pay.', primaryId: null, secondary: [] }
    }

    if (sv === 'Completed') {
      if (isAdmin) {
        return { message: 'The main shop handover is done. You will act again when a return is due.', primaryId: null, secondary: [] }
      }
      return { message: 'Your main shop handover is done.', primaryId: null, secondary: [] }
    }
  }

  if (isAdmin && (es === 'Ongoing' || es === 'ReturnPending' || es === 'Overstayed') && !row.actual_return_date) {
    const secondary = []
    if (st === 'Approved' || st === 'Ongoing') {
      secondary.push({ id: NA.EXTEND, label: 'Change end date' })
    }
    return {
      message: 'The employee is away or was due back — record the return when you have it.',
      primaryId: NA.RETURN,
      primaryLabel: 'Confirm return',
      secondary,
    }
  }

  return { message: 'No action is needed right now.', primaryId: null, secondary: [] }
}

export function getLeaveKeyInfo(row) {
  const d = row.leave_days ?? alDaysBetween(row.from_date, row.to_date)
  const out = {
    days: d,
    shopLine: null,
    salaryLine: null,
  }
  if (row.status === 'Approved' && row.shop_visit_date) {
    const part = [fmtDMY(row.shop_visit_date), row.shop_visit_time || ''].filter(Boolean)
    out.shopLine = part.join(' · ') || '—'
  }
  if (row.calculated_leave_amount != null) {
    out.salaryLine = `AED ${Number(row.calculated_leave_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return out
}
