const test = require('node:test')
const assert = require('node:assert/strict')

const { isAttendanceStatus, isIsoCalendarDate } = require('../src/lib/attendanceValidation.ts')

test('isAttendanceStatus accepts only known attendance codes', () => {
  for (const code of ['P', 'A', 'SL', 'AL', 'WH', '-']) assert.equal(isAttendanceStatus(code), true)
  for (const code of ['', 'p', 'X', 'Present', null, undefined, 1]) assert.equal(isAttendanceStatus(code), false)
})

test('isIsoCalendarDate requires a real YYYY-MM-DD calendar date', () => {
  assert.equal(isIsoCalendarDate('2026-11-09'), true)
  assert.equal(isIsoCalendarDate('2028-02-29'), true)
  assert.equal(isIsoCalendarDate('2026-02-29'), false)
  assert.equal(isIsoCalendarDate('2026-11-31'), false)
  assert.equal(isIsoCalendarDate('2026-11-09T00:00:00Z'), false)
  assert.equal(isIsoCalendarDate('09/11/2026'), false)
})
