import { describe, expect, it } from 'vitest'
import {
  addDays,
  businessToday,
  clampToMonth,
  type CalendarDate,
  formatDate,
  parseIsoDate,
  parseWeeklyOffDay,
  shiftMonth,
} from './attendanceCalendar'
import {
  type AttendanceEmployee,
  buildDayCsv,
  buildMonthCsv,
  buildMonthStrip,
  employeeMonthTotals,
  type MonthRecords,
  monthToDateRate,
  NO_DEPARTMENT,
  type ResolveContext,
  resolveCell,
  rowsToMonthRecords,
  scopeEmployees,
  summarizeDay,
} from './attendanceModel'

const SUNDAY = 0
const today: CalendarDate = { year: 2026, month: 10, day: 9 } // Mon 9 Nov 2026
const nov = (day: number): CalendarDate => ({ year: 2026, month: 10, day })

function emp(id: string, extra: Partial<AttendanceEmployee> = {}): AttendanceEmployee {
  return { id, name: `Employee ${id}`, department: 'Warehouse', ...extra }
}

function rec(status: string, extra: { annualLeaveId?: number; documentUrl?: string } = {}) {
  return { status, annualLeaveId: extra.annualLeaveId ?? null, documentUrl: extra.documentUrl ?? null }
}

function ctxWith(records: MonthRecords, defaultWeeklyOff = SUNDAY): ResolveContext {
  return { records, today, defaultWeeklyOff }
}

describe('attendance calendar', () => {
  it('uses the Asia/Dubai calendar day, not UTC or the browser zone', () => {
    expect(businessToday(new Date('2026-11-08T20:30:00Z'))).toEqual(nov(9))
    expect(businessToday(new Date('2026-12-31T21:00:00Z'))).toEqual({ year: 2027, month: 0, day: 1 })
  })

  it('clamps days when switching months and handles leap years', () => {
    expect(clampToMonth(2026, 1, 31)).toEqual({ year: 2026, month: 1, day: 28 })
    expect(clampToMonth(2028, 1, 31)).toEqual({ year: 2028, month: 1, day: 29 })
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
    expect(addDays({ year: 2028, month: 1, day: 28 }, 1)).toEqual({ year: 2028, month: 1, day: 29 })
    expect(addDays({ year: 2026, month: 2, day: 1 }, -1)).toEqual({ year: 2026, month: 1, day: 28 })
  })

  it('parses dates without time-zone shifts and rejects impossible dates', () => {
    expect(parseIsoDate('2026-03-02')).toEqual({ year: 2026, month: 2, day: 2 })
    expect(parseIsoDate('2026-02-30')).toBeNull()
    expect(parseIsoDate('garbage')).toBeNull()
    expect(formatDate(nov(9))).toBe('9 Nov 2026')
    expect(formatDate(nov(9), { weekday: true })).toBe('Mon, 9 Nov 2026')
  })

  it('reads profile weekly off days in every stored form', () => {
    expect(parseWeeklyOffDay('friday')).toBe(5)
    expect(parseWeeklyOffDay('Friday ')).toBe(5)
    expect(parseWeeklyOffDay('6')).toBe(6)
    expect(parseWeeklyOffDay('')).toBeNull()
    expect(parseWeeklyOffDay(null)).toBeNull()
    expect(parseWeeklyOffDay('someday')).toBeNull()
  })
})

describe('rowsToMonthRecords', () => {
  it('keys records by the calendar day in the string and drops rows from other months', () => {
    const records = rowsToMonthRecords(
      [
        { employee_id: 7, attendance_date: '2026-11-02', status: 'P' },
        { employee_id: 7, attendance_date: '2026-10-31', status: 'A' },
        { employee_id: 7, attendance_date: '2026-11-03', status: 'AL', annual_leave_id: 4 },
      ],
      2026,
      10
    )
    expect(Object.keys(records['7'])).toEqual(['2', '3'])
    expect(records['7'][3]).toEqual({ status: 'AL', annualLeaveId: 4, documentUrl: null })
  })
})

describe('resolveCell', () => {
  it('uses each employee’s own weekly off day before the default', () => {
    const friday = nov(6)
    const sunday = nov(8)
    const ctx = ctxWith({})
    const own = emp('1', { weeklyOffDay: 'friday' })
    const fallback = emp('2')
    expect(resolveCell(own, friday, ctx)).toMatchObject({ status: 'WH', kind: 'scheduled' })
    expect(resolveCell(own, sunday, ctx)).toMatchObject({ status: null, kind: 'unmarked' })
    expect(resolveCell(fallback, sunday, ctx)).toMatchObject({ status: 'WH', kind: 'scheduled' })
  })

  it('never lets the schedule override a recorded status or an explicit blank', () => {
    const ctx = ctxWith({ '1': { 8: rec('P'), 15: rec('-') } })
    expect(resolveCell(emp('1'), nov(8), ctx)).toMatchObject({ status: 'P', kind: 'recorded' })
    expect(resolveCell(emp('1'), nov(15), ctx)).toMatchObject({ status: null, kind: 'future', explicitBlank: true })
  })

  it('separates future, unmarked and approved leave', () => {
    const ctx = ctxWith({ '1': { 20: rec('AL', { annualLeaveId: 3 }) } })
    expect(resolveCell(emp('1'), nov(9), ctx).kind).toBe('unmarked')
    expect(resolveCell(emp('1'), nov(10), ctx).kind).toBe('future')
    expect(resolveCell(emp('1'), nov(20), ctx)).toMatchObject({ status: 'AL', approvedLeave: true, isFuture: true })
  })
})

describe('summarizeDay', () => {
  const staff = [emp('1'), emp('2'), emp('3', { weeklyOffDay: 'monday' }), emp('4'), emp('5')]

  it('reconciles every employee into exactly one bucket and uses the established rate denominator', () => {
    const ctx = ctxWith({ '1': { 9: rec('P') }, '2': { 9: rec('SL') }, '4': { 9: rec('AL') } })
    const s = summarizeDay(staff, nov(9), ctx)
    expect(s.P + s.A + s.SL + s.AL + s.WH + s.unmarked).toBe(s.total)
    expect(s).toMatchObject({ P: 1, SL: 1, AL: 1, WH: 1, unmarked: 1, eligible: 3 })
    expect(s.rate).toBe(33.3)
  })

  it('reports N/A when nobody is expected to work and no rate for future dates', () => {
    const allOff = summarizeDay([emp('3', { weeklyOffDay: 'monday' })], nov(9), ctxWith({}))
    expect(allOff).toMatchObject({ rate: null, rateUnavailable: 'no-eligible' })
    const future = summarizeDay(staff, nov(10), ctxWith({}))
    expect(future).toMatchObject({ rate: null, rateUnavailable: 'future', unmarked: 5 })
    expect(summarizeDay([], nov(9), ctxWith({}))).toMatchObject({ rate: null, rateUnavailable: 'no-eligible' })
  })
})

describe('month strip', () => {
  it('keeps future days neutral and does not count days with nothing recorded as absences', () => {
    const staff = [emp('1'), emp('2')]
    const ctx = ctxWith({ '1': { 2: rec('P') }, '2': { 2: rec('P'), 3: rec('A') } })
    const strip = buildMonthStrip(staff, 2026, 10, ctx)
    expect(strip).toHaveLength(30)
    expect(strip[1].tone).toBe('max') // 2 Nov: 2/2 present
    expect(strip[2].tone).toBe('low') // 3 Nov: 0 present, 1 absent, 1 unmarked
    expect(strip[3].tone).toBe('no-records') // 4 Nov: nothing recorded
    expect(strip[7].tone).toBe('no-eligible') // Sun 8 Nov: everyone on weekly holiday
    expect(strip.slice(9).every((d) => d.tone === 'future')).toBe(true)
    expect(monthToDateRate(strip)).toEqual({ rate: 50, days: 2 })
  })
})

describe('employeeMonthTotals', () => {
  it('counts the whole month, flags upcoming leave and holidays, and counts unmarked only to date', () => {
    const ctx = ctxWith({ '1': { 2: rec('P'), 3: rec('A'), 20: rec('AL', { annualLeaveId: 1 }) } })
    const totals = employeeMonthTotals(emp('1'), 2026, 10, ctx)
    expect(totals).toMatchObject({ P: 1, A: 1, AL: 1, futureAL: 1, WH: 5, futureWH: 3 })
    // 1–9 Nov: 9 days − P − A − Sun 1 − Sun 8 = 5 unmarked; days after today are not "missing".
    expect(totals.unmarkedToDate).toBe(5)
  })
})

describe('scope and exports', () => {
  const staff = [
    emp('1', { name: 'Ali Hassan', employeeCode: 'E-1' }),
    emp('2', { name: 'Sara Khan', department: 'Sales' }),
    emp('3', { name: '=cmd', department: '' }),
  ]

  it('filters by department (including “No department”) and search over name, code and department', () => {
    expect(scopeEmployees(staff, 'Sales', '').map((e) => e.id)).toEqual(['2'])
    expect(scopeEmployees(staff, NO_DEPARTMENT, '').map((e) => e.id)).toEqual(['3'])
    expect(scopeEmployees(staff, 'all', 'e-1').map((e) => e.id)).toEqual(['1'])
    expect(scopeEmployees(staff, 'all', 'warehouse').map((e) => e.id)).toEqual(['1'])
  })

  it('exports exactly the scoped employees for the stated range and neutralises formulas', () => {
    const ctx = ctxWith({ '1': { 9: rec('P') } })
    const scoped = scopeEmployees(staff, 'Warehouse', '')
    const month = buildMonthCsv(scoped, 2026, 10, ctx).split('\r\n')
    expect(month).toHaveLength(2)
    expect(month[0]).toContain('2026-11-01')
    expect(month[0]).toContain('2026-11-30')
    expect(month[0]).not.toContain('2026-12-01')
    const day = buildDayCsv(staff, nov(9), ctx).split('\r\n')
    expect(day[1]).toContain('2026-11-09,E-1,Ali Hassan,Warehouse,,P,Present,Recorded')
    expect(day[3]).toContain("'=cmd")
  })
})
