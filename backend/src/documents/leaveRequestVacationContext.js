const { formatDMY, isoDatePart, calendarYearFromTimestamp } = require('./letterDates')

/**
 * Maps DB row (annual_leave + employee + alternate) → PDF template fields.
 * @param {object} row from annualLeaveService.findByIdWithEmployee
 */
function buildLeaveRequestVacationContext(row) {
  const fromIso = isoDatePart(row.from_date)
  const toIso = isoDatePart(row.to_date)
  let leaveDays = row.leave_days
  if (leaveDays == null && fromIso && toIso) {
    const a = new Date(`${fromIso}T12:00:00.000Z`)
    const b = new Date(`${toIso}T12:00:00.000Z`)
    leaveDays = Math.floor((b - a) / 86400000) + 1
  }
  const altName =
    row.alternate_employee_full_name != null && String(row.alternate_employee_full_name).trim()
      ? String(row.alternate_employee_full_name).trim()
      : null

  return {
    applicationDateFormatted: formatDMY(row.created_at),
    employeeName: String(row.full_name || '').trim(),
    designation: String(row.designation || '').trim() || 'Employee',
    currentYear: String(calendarYearFromTimestamp(row.created_at)),
    numberOfDays: String(Math.max(0, Number(leaveDays) || 0)),
    leaveStartFormatted: formatDMY(row.from_date),
    leaveEndFormatted: formatDMY(row.to_date),
    /** Full name when set; used in handover sentence */
    alternateEmployeeName: altName,
    /** Wording inside "hand over … to ___" */
    alternateHandoverPhrase: altName || 'my designated alternate',
  }
}

function validateLeaveRequestVacationContext(ctx) {
  const errors = []
  if (!ctx.employeeName) errors.push('Employee name is required')
  if (!ctx.leaveStartFormatted || ctx.leaveStartFormatted === '—') errors.push('Leave start date is required')
  if (!ctx.leaveEndFormatted || ctx.leaveEndFormatted === '—') errors.push('Leave end date is required')
  if (!ctx.numberOfDays || ctx.numberOfDays === '0') errors.push('Leave duration must be at least one day')
  return { ok: errors.length === 0, errors }
}

module.exports = { buildLeaveRequestVacationContext, validateLeaveRequestVacationContext }
