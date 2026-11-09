import {
  type CalendarDate,
  compareDates,
  daysInMonth,
  formatDate,
  parseIsoDate,
  parseWeeklyOffDay,
  toIsoDate,
  weekdayOf,
} from './attendanceCalendar'

export const STATUS_CODES = ['P', 'A', 'SL', 'AL', 'WH'] as const
export type StatusCode = (typeof STATUS_CODES)[number]

/** Stored to mean "deliberately unmarked" — it overrides the automatic weekly holiday for that day. */
export const EXPLICIT_BLANK = '-'

export const STATUS_LABELS: Record<StatusCode, string> = {
  P: 'Present',
  A: 'Absent',
  SL: 'Sick leave',
  AL: 'Annual leave',
  WH: 'Weekly holiday',
}

export function isStatusCode(value: unknown): value is StatusCode {
  return typeof value === 'string' && (STATUS_CODES as readonly string[]).includes(value)
}

export interface AttendanceEmployee {
  id: string
  name: string
  employeeCode?: string | null
  department?: string | null
  designation?: string | null
  photoUrl?: string | null
  /** Profile weekly off day (`friday`); null/empty means "use the default weekly holiday". */
  weeklyOffDay?: string | null
}

export interface DayRecord {
  status: string
  /** Set when the day was written by an approved annual-leave request. */
  annualLeaveId: number | null
  documentUrl: string | null
}

/** employeeId → day of month → stored record */
export type MonthRecords = Record<string, Record<number, DayRecord>>

export interface AttendanceApiRow {
  employee_id: number | string
  attendance_date: string
  status: string
  sick_leave_document_url?: string | null
  annual_leave_id?: number | null
}

export function rowToRecord(row: AttendanceApiRow): DayRecord {
  return {
    status: String(row.status ?? ''),
    annualLeaveId: row.annual_leave_id ?? null,
    documentUrl: row.sick_leave_document_url ?? null,
  }
}

/** Builds the month map, ignoring rows that do not belong to the requested month. */
export function rowsToMonthRecords(rows: unknown, year: number, month: number): MonthRecords {
  const out: MonthRecords = {}
  if (!Array.isArray(rows)) return out
  for (const row of rows as AttendanceApiRow[]) {
    const date = parseIsoDate(row?.attendance_date)
    if (!date || date.year !== year || date.month !== month) continue
    const empId = String(row.employee_id)
    if (!out[empId]) out[empId] = {}
    out[empId][date.day] = rowToRecord(row)
  }
  return out
}

/** Weekly off day for an employee: their profile day, otherwise the configured default. */
export function weeklyOffFor(employee: AttendanceEmployee, defaultWeeklyOff: number): number {
  return parseWeeklyOffDay(employee.weeklyOffDay) ?? defaultWeeklyOff
}

export type CellKind =
  /** A stored status. */
  | 'recorded'
  /** No record, but the employee's weekly off day — counted as WH. */
  | 'scheduled'
  /** Elapsed day (including today) with nothing recorded. */
  | 'unmarked'
  /** Future day with nothing recorded. */
  | 'future'

export interface CellInfo {
  status: StatusCode | null
  kind: CellKind
  isFuture: boolean
  /** AL written by an approved annual-leave request. */
  approvedLeave: boolean
  /** The stored `-` override (day explicitly not a holiday). */
  explicitBlank: boolean
  /** Falls on the employee's weekly off day. */
  weeklyOffDay: boolean
  documentUrl: string | null
  record: DayRecord | null
}

export interface ResolveContext {
  records: MonthRecords
  today: CalendarDate
  defaultWeeklyOff: number
}

export function resolveCell(employee: AttendanceEmployee, date: CalendarDate, ctx: ResolveContext): CellInfo {
  const record = ctx.records[employee.id]?.[date.day] ?? null
  const isFuture = compareDates(date, ctx.today) > 0
  const weeklyOffDay = weekdayOf(date) === weeklyOffFor(employee, ctx.defaultWeeklyOff)
  const base = {
    isFuture,
    weeklyOffDay,
    record,
    documentUrl: record?.documentUrl ?? null,
    approvedLeave: false,
    explicitBlank: false,
  }
  if (record && isStatusCode(record.status)) {
    return {
      ...base,
      status: record.status,
      kind: 'recorded',
      approvedLeave: record.status === 'AL' && record.annualLeaveId != null,
    }
  }
  const explicitBlank = record?.status === EXPLICIT_BLANK
  if (!explicitBlank && weeklyOffDay) {
    return { ...base, status: 'WH', kind: 'scheduled' }
  }
  return { ...base, explicitBlank, status: null, kind: isFuture ? 'future' : 'unmarked' }
}

export interface DayCounts {
  P: number
  A: number
  SL: number
  AL: number
  WH: number
  /** No status. On future dates these are simply "not yet recorded". */
  unmarked: number
}

export type RateUnavailableReason = 'future' | 'no-eligible'

export interface DaySummary extends DayCounts {
  date: CalendarDate
  isFuture: boolean
  total: number
  /** Attendance-rate denominator: total − weekly holiday − annual leave. */
  eligible: number
  /** Present ÷ eligible × 100, one decimal. Null when not meaningful. */
  rate: number | null
  rateUnavailable: RateUnavailableReason | null
}

export function emptyCounts(): DayCounts {
  return { P: 0, A: 0, SL: 0, AL: 0, WH: 0, unmarked: 0 }
}

export function roundRate(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 1000) / 10
}

export function summarizeDay(employees: AttendanceEmployee[], date: CalendarDate, ctx: ResolveContext): DaySummary {
  const counts = emptyCounts()
  for (const employee of employees) {
    const cell = resolveCell(employee, date, ctx)
    if (cell.status) counts[cell.status]++
    else counts.unmarked++
  }
  const isFuture = compareDates(date, ctx.today) > 0
  const eligible = employees.length - counts.WH - counts.AL
  let rate: number | null = null
  let rateUnavailable: RateUnavailableReason | null = null
  if (isFuture) rateUnavailable = 'future'
  else if (eligible <= 0) rateUnavailable = 'no-eligible'
  else rate = roundRate(counts.P, eligible)
  return { ...counts, date, isFuture, total: employees.length, eligible, rate, rateUnavailable }
}

export type StripTone = 'future' | 'no-eligible' | 'no-records' | 'low' | 'mid' | 'high' | 'max'

export interface StripDay {
  summary: DaySummary
  tone: StripTone
}

export function stripTone(summary: DaySummary): StripTone {
  if (summary.isFuture) return 'future'
  if (summary.eligible <= 0) return 'no-eligible'
  if (summary.P + summary.A + summary.SL === 0) return 'no-records'
  const rate = summary.rate ?? 0
  if (rate < 60) return 'low'
  if (rate < 80) return 'mid'
  if (rate < 90) return 'high'
  return 'max'
}

export function buildMonthStrip(
  employees: AttendanceEmployee[],
  year: number,
  month: number,
  ctx: ResolveContext
): StripDay[] {
  const days: StripDay[] = []
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const summary = summarizeDay(employees, { year, month, day }, ctx)
    days.push({ summary, tone: stripTone(summary) })
  }
  return days
}

/**
 * Month-to-date rate: Σ present ÷ Σ eligible over elapsed days that have at least one P/A/SL record.
 * Days with nothing recorded are left out so missing data does not read as absence.
 */
export function monthToDateRate(strip: StripDay[]): { rate: number | null; days: number } {
  let present = 0
  let eligible = 0
  let days = 0
  for (const { summary, tone } of strip) {
    if (tone === 'future' || tone === 'no-eligible' || tone === 'no-records') continue
    present += summary.P
    eligible += summary.eligible
    days++
  }
  return { rate: eligible > 0 ? roundRate(present, eligible) : null, days }
}

export interface EmployeeMonthTotals extends Record<StatusCode, number> {
  /** Elapsed days (including today) with no status. */
  unmarkedToDate: number
  /** Future AL days included in AL. */
  futureAL: number
  /** Future weekly holidays included in WH. */
  futureWH: number
}

/** Whole-month totals (established rule: includes approved future leave and scheduled weekly holidays). */
export function employeeMonthTotals(
  employee: AttendanceEmployee,
  year: number,
  month: number,
  ctx: ResolveContext
): EmployeeMonthTotals {
  const totals: EmployeeMonthTotals = { P: 0, A: 0, SL: 0, AL: 0, WH: 0, unmarkedToDate: 0, futureAL: 0, futureWH: 0 }
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const cell = resolveCell(employee, { year, month, day }, ctx)
    if (cell.status) {
      totals[cell.status]++
      if (cell.isFuture && cell.status === 'AL') totals.futureAL++
      if (cell.isFuture && cell.status === 'WH') totals.futureWH++
    } else if (!cell.isFuture) {
      totals.unmarkedToDate++
    }
  }
  return totals
}

export const NO_DEPARTMENT = '__none__'

export function departmentOf(employee: AttendanceEmployee): string {
  return (employee.department || '').trim()
}

export function listDepartments(employees: AttendanceEmployee[]): { value: string; label: string }[] {
  const names = new Set<string>()
  let hasEmpty = false
  for (const employee of employees) {
    const dept = departmentOf(employee)
    if (dept) names.add(dept)
    else hasEmpty = true
  }
  const options = [...names].sort((a, b) => a.localeCompare(b)).map((d) => ({ value: d, label: d }))
  if (hasEmpty) options.push({ value: NO_DEPARTMENT, label: 'No department' })
  return options
}

/** The page scope: department + search. Every summary, list, and export uses this same list. */
export function scopeEmployees(employees: AttendanceEmployee[], department: string, search: string): AttendanceEmployee[] {
  const query = search.trim().toLowerCase()
  return employees.filter((employee) => {
    if (department && department !== 'all') {
      const dept = departmentOf(employee)
      if (department === NO_DEPARTMENT ? dept !== '' : dept !== department) return false
    }
    if (!query) return true
    return [employee.name, employee.department, employee.designation, employee.employeeCode].some((value) =>
      String(value || '')
        .toLowerCase()
        .includes(query)
    )
  })
}

export const ROW_FILTERS = ['all', 'absent-day', 'leave-day', 'unmarked-day', 'absent-month', 'unmarked-month'] as const
export type RowFilter = (typeof ROW_FILTERS)[number]

export const ROW_FILTER_LABELS: Record<RowFilter, string> = {
  all: 'All employees',
  'absent-day': 'Absent on selected day',
  'leave-day': 'On leave on selected day (SL / AL)',
  'unmarked-day': 'Unmarked on selected day',
  'absent-month': 'Any absence this month',
  'unmarked-month': 'Unmarked days this month',
}

export function matchesRowFilter(
  employee: AttendanceEmployee,
  filter: RowFilter,
  selected: CalendarDate,
  ctx: ResolveContext
): boolean {
  if (filter === 'all') return true
  if (filter === 'absent-month' || filter === 'unmarked-month') {
    const totals = employeeMonthTotals(employee, selected.year, selected.month, ctx)
    return filter === 'absent-month' ? totals.A > 0 : totals.unmarkedToDate > 0
  }
  const cell = resolveCell(employee, selected, ctx)
  if (filter === 'absent-day') return cell.status === 'A'
  if (filter === 'leave-day') return cell.status === 'SL' || cell.status === 'AL'
  return cell.status === null
}

export function cellSourceLabel(cell: CellInfo): string {
  if (cell.kind === 'recorded') return cell.approvedLeave ? 'Approved annual leave' : 'Recorded'
  if (cell.kind === 'scheduled') return 'Scheduled weekly holiday'
  if (cell.kind === 'future') return 'Not yet recorded'
  return cell.explicitBlank ? 'Marked as not a holiday' : 'Unmarked'
}

function csvCell(value: string | number): string {
  let text = String(value ?? '')
  // Neutralise spreadsheet formulas in free-text fields.
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function buildDayCsv(employees: AttendanceEmployee[], date: CalendarDate, ctx: ResolveContext): string {
  const rows: (string | number)[][] = [
    ['Date', 'Employee code', 'Name', 'Department', 'Designation', 'Status code', 'Status', 'Source'],
  ]
  const iso = toIsoDate(date)
  for (const employee of employees) {
    const cell = resolveCell(employee, date, ctx)
    rows.push([
      iso,
      employee.employeeCode || '',
      employee.name,
      departmentOf(employee),
      employee.designation || '',
      cell.status || '',
      cell.status ? STATUS_LABELS[cell.status] : '',
      cellSourceLabel(cell),
    ])
  }
  return toCsv(rows)
}

export function buildMonthCsv(employees: AttendanceEmployee[], year: number, month: number, ctx: ResolveContext): string {
  const dim = daysInMonth(year, month)
  const days = Array.from({ length: dim }, (_, i) => i + 1)
  const header = [
    'Employee code',
    'Name',
    'Department',
    ...days.map((day) => toIsoDate({ year, month, day })),
    'P',
    'A',
    'SL',
    'AL',
    'WH',
    'Unmarked to date',
  ]
  const rows: (string | number)[][] = [header]
  for (const employee of employees) {
    const totals = employeeMonthTotals(employee, year, month, ctx)
    rows.push([
      employee.employeeCode || '',
      employee.name,
      departmentOf(employee),
      ...days.map((day) => resolveCell(employee, { year, month, day }, ctx).status || ''),
      totals.P,
      totals.A,
      totals.SL,
      totals.AL,
      totals.WH,
      totals.unmarkedToDate,
    ])
  }
  return toCsv(rows)
}

export function previousDayLabel(date: CalendarDate): string {
  return formatDate({ ...date, day: date.day - 1 }, { year: false })
}
