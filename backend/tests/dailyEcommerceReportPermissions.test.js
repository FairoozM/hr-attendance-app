'use strict'

/**
 * Permission checks for Daily Ecommerce Report routes (export middleware).
 */

const test = require('node:test')
const assert = require('node:assert/strict')

function requireWeeklyReportsExport(req, res) {
  if (!req.user) return { status: 401 }
  if (req.user.role === 'admin' || req.user.role === 'warehouse') return { status: 200 }
  const mod = req.user.permissions?.weekly_reports || {}
  if (mod.export || mod.view || mod.manage) return { status: 200 }
  return { status: 403 }
}

test('export allowed for admin', () => {
  assert.equal(requireWeeklyReportsExport({ user: { role: 'admin' } }).status, 200)
})

test('export allowed for employee with view', () => {
  assert.equal(
    requireWeeklyReportsExport({
      user: { role: 'employee', permissions: { weekly_reports: { view: true } } },
    }).status,
    200,
  )
})

test('export allowed for employee with export only', () => {
  assert.equal(
    requireWeeklyReportsExport({
      user: { role: 'employee', permissions: { weekly_reports: { export: true } } },
    }).status,
    200,
  )
})

test('export denied without weekly_reports permissions', () => {
  assert.equal(
    requireWeeklyReportsExport({
      user: { role: 'employee', permissions: {} },
    }).status,
    403,
  )
})

test('export denied when unauthenticated', () => {
  assert.equal(requireWeeklyReportsExport({ user: null }).status, 401)
})
