'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

function stubModule(relativePath, exports) {
  const resolved = require.resolve(relativePath)
  const previous = require.cache[resolved]
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }
  return () => {
    if (previous) require.cache[resolved] = previous
    else delete require.cache[resolved]
  }
}

function freshModule(relativePath) {
  delete require.cache[require.resolve(relativePath)]
  return require(relativePath)
}

test('getCachedSummaryForDate never starts a build and reports missing', () => {
  let builds = 0
  const restore = stubModule('../src/services/ecommerceSummary/ecommerceSummaryService', {
    buildEcommerceSummaryReport: async () => {
      builds += 1
      return { reportDate: '2026-09-18', day: {} }
    },
  })
  try {
    const mod = freshModule('../src/services/ecommerceSummary/ecommerceSummaryJobService')
    const cached = mod.getCachedSummaryForDate('2026-09-18')
    assert.equal(cached.status, 'missing')
    assert.equal(cached.report, null)
    assert.equal(builds, 0)
  } finally {
    restore()
  }
})

test('getCachedSummaryForDate returns ready after a completed job without rebuilding', async () => {
  const restore = stubModule('../src/services/ecommerceSummary/ecommerceSummaryService', {
    buildEcommerceSummaryReport: async ({ date }) => ({
      reportDate: date,
      day: { cashSales: 0, creditSales: 1, saleReturn: 0, totalSales: 1 },
      dayName: 'Friday',
      totalDays: 1,
    }),
  })
  try {
    const mod = freshModule('../src/services/ecommerceSummary/ecommerceSummaryJobService')
    const started = mod.startSummaryJob({ date: '2026-09-18' })
    assert.equal(started.status, 'queued')
    // Allow setImmediate job to finish
    await new Promise((r) => setTimeout(r, 30))
    const cached = mod.getCachedSummaryForDate('2026-09-18')
    assert.equal(cached.status, 'ready')
    assert.equal(cached.report.reportDate, '2026-09-18')
    assert.equal(cached.report.day.totalSales, 1)
  } finally {
    restore()
  }
})
