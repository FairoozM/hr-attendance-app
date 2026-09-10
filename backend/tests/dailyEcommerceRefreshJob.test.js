'use strict'

/**
 * Background refresh for the Daily Ecommerce Report.
 *
 * The point of the job is that the HTTP request returns before the work finishes: a full refresh
 * creates and polls Noon's export jobs, which runs well past the 30s CloudFront origin timeout in
 * front of this API. These tests pin that contract — start returns immediately, the result arrives
 * by polling, and one failing integration neither blocks nor hides the others.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

/** Replace a module in the require cache so the unit under test gets a stub. */
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

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * @param {{ amazon?: Function, amazonReport?: Function, noonOrders?: Function,
 *           noonFinance?: Function, noonSkuSales?: Function, noonCatalog?: Function, website?: object,
 *           report?: object|Function }} behaviour
 */
function loadJobServiceWith(behaviour = {}) {
  const calls = {
    amazon: [],
    amazonReport: [],
    noonOrders: [],
    noonFinance: [],
    noonSkuSales: [],
    noonCatalog: [],
    website: 0,
    report: [],
  }
  const restores = [
    stubModule('../src/services/amazonOrdersSyncService', {
      syncAmazonOrders: async (opts) => {
        calls.amazon.push(opts)
        if (behaviour.amazon) return behaviour.amazon(opts)
        return { ordersFetched: 3, ordersSaved: 3, orderItemsFetched: 4, pagesFetched: 1 }
      },
    }),
    stubModule('../src/services/amazonOrderReportSyncService', {
      syncAmazonOrderReport: async (opts) => {
        calls.amazonReport.push(opts)
        if (behaviour.amazonReport) return behaviour.amazonReport(opts)
        return {
          reportId: '58382020706',
          reused: false,
          polls: 1,
          rowsParsed: 15,
          rowsSaved: 15,
          rowsRemoved: 0,
          uniqueOrders: 15,
          linesWithoutMoney: 1,
        }
      },
    }),
    stubModule('../src/services/noon/noonOrdersExportService', {
      syncNoonOrders: async (opts) => {
        calls.noonOrders.push(opts)
        if (behaviour.noonOrders) return behaviour.noonOrders(opts)
        return { exportCode: 'EXP1', pollCount: 6, rowsParsed: 9, rowsSaved: 9, uniqueOrders: 9 }
      },
      syncNoonFinance: async (opts) => {
        calls.noonFinance.push(opts)
        if (behaviour.noonFinance) return behaviour.noonFinance(opts)
        return { exportCode: 'EXP2', pollCount: 5, rowsParsed: 0, rowsSaved: 0, ordersWithMoney: 0 }
      },
      syncNoonCatalogPrices: async (opts) => {
        calls.noonCatalog.push(opts)
        if (behaviour.noonCatalog) return behaviour.noonCatalog(opts)
        return {
          exportCategoryCode: 'noon_catalog_catalogexport',
          exportCode: 'EXP4',
          rowsParsed: 541,
          rowsSaved: 541,
          skusWithPrice: 521,
        }
      },
      syncNoonSkuDailySales: async (opts) => {
        calls.noonSkuSales.push(opts)
        if (behaviour.noonSkuSales) return behaviour.noonSkuSales(opts)
        return {
          exportCategoryCode: 'noon_catalog_reports_productviewsandsalesdata',
          exportCode: 'EXP3',
          rowsParsed: 201,
          rowsSaved: 9,
          rowsWithoutUnits: 192,
          datesWithSales: ['2026-09-09'],
        }
      },
    }),
    stubModule('../src/db/lifesmileWebsiteDb', {
      ENV_VAR: 'LIFESMILE_WEBSITE_DATABASE_URL',
      isConfigured: () => behaviour.website?.configured !== false,
      checkHealth: async () => behaviour.website?.health || { reachable: true },
      readQuery: async () => {
        calls.website += 1
        if (behaviour.website?.readError) throw behaviour.website.readError
        return { rows: [{ orders: '4', cart_items: '7' }] }
      },
    }),
    stubModule('../src/services/dailyEcommerceReport/dailyEcommerceReportService', {
      buildDailyEcommerceReport: async (opts) => {
        calls.report.push(opts)
        if (typeof behaviour.report === 'function') return behaviour.report(opts)
        return behaviour.report || { date: opts.date, channels: [], totals: {} }
      },
    }),
  ]
  const mod = freshModule('../src/services/dailyEcommerceReport/dailyEcommerceRefreshJobService')
  return { mod, calls, restore: () => restores.forEach((r) => r()) }
}

async function waitForJob(mod, jobId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = mod.getRefreshJob(jobId)
    if (job && (job.status === 'completed' || job.status === 'failed')) return job
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not settle: ${job?.status}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

test('starting a refresh returns before any integration has been called', async () => {
  // The whole reason the job exists: the HTTP response cannot wait for Noon.
  const gate = deferred()
  const { mod, calls, restore } = loadJobServiceWith({
    noonOrders: async () => {
      await gate.promise
      return { exportCode: 'EXP1', pollCount: 6, rowsParsed: 1, rowsSaved: 1, uniqueOrders: 1 }
    },
  })
  try {
    const started = mod.startRefreshJob({ date: '2026-09-09' })
    assert.ok(started.jobId, 'the caller gets an id to poll')
    assert.equal(started.status, 'queued')
    assert.equal(started.report, null)
    assert.equal(calls.noonOrders.length, 0, 'nothing has run yet when the response is built')

    gate.resolve()
    const done = await waitForJob(mod, started.jobId)
    assert.equal(done.status, 'completed')
    assert.equal(done.report.date, '2026-09-09')
  } finally {
    restore()
  }
})

test('the job reports per-integration progress while it runs', async () => {
  const gate = deferred()
  const { mod, restore } = loadJobServiceWith({
    noonFinance: async () => {
      await gate.promise
      return { exportCode: 'EXP2', pollCount: 5, rowsParsed: 0, rowsSaved: 0, ordersWithMoney: 0 }
    },
  })
  try {
    const started = mod.startRefreshJob({ date: '2026-09-09' })
    // Let the other integrations finish while the finance export is held open.
    await new Promise((r) => setTimeout(r, 30))
    const mid = mod.getRefreshJob(started.jobId)
    assert.equal(mid.status, 'running')
    assert.equal(
      mid.progress.totalSteps,
      9,
      'two Amazon order syncs, two Amazon order reports, four Noon exports, one website',
    )
    assert.ok(mid.progress.completedSteps < 9 && mid.progress.completedSteps > 0)
    assert.equal(mid.report, null, 'no report until every integration has settled')

    gate.resolve()
    const done = await waitForJob(mod, started.jobId)
    assert.equal(done.progress.completedSteps, 9)
    assert.ok(done.report)
  } finally {
    restore()
  }
})

test('a second Refresh for the same date joins the running job instead of starting another', async () => {
  const gate = deferred()
  const { mod, calls, restore } = loadJobServiceWith({
    noonOrders: async () => {
      await gate.promise
      return { exportCode: 'EXP1', pollCount: 1, rowsParsed: 0, rowsSaved: 0, uniqueOrders: 0 }
    },
  })
  try {
    const first = mod.startRefreshJob({ date: '2026-09-09' })
    const second = mod.startRefreshJob({ date: '2026-09-09' })
    assert.equal(second.jobId, first.jobId)
    assert.equal(second.alreadyRunning, true)

    gate.resolve()
    await waitForJob(mod, first.jobId)
    assert.equal(calls.noonOrders.length, 1, 'Noon must not be asked for the same export twice')
    assert.equal(calls.amazon.length, 2, 'one sync per Amazon marketplace, not two')
  } finally {
    restore()
  }
})

test('a different date gets its own job', async () => {
  const { mod, restore } = loadJobServiceWith({})
  try {
    const a = mod.startRefreshJob({ date: '2026-09-08' })
    const b = mod.startRefreshJob({ date: '2026-09-09' })
    assert.notEqual(a.jobId, b.jobId)
    await waitForJob(mod, a.jobId)
    await waitForJob(mod, b.jobId)
  } finally {
    restore()
  }
})

test('once a job finishes, the same date can be refreshed again', async () => {
  const { mod, restore } = loadJobServiceWith({})
  try {
    const first = mod.startRefreshJob({ date: '2026-09-09' })
    await waitForJob(mod, first.jobId)
    assert.equal(mod.getActiveRefreshJob('2026-09-09'), null, 'a finished job is not active')
    const second = mod.startRefreshJob({ date: '2026-09-09' })
    assert.notEqual(second.jobId, first.jobId)
    await waitForJob(mod, second.jobId)
  } finally {
    restore()
  }
})

test('one failing integration neither blocks nor erases the others', async () => {
  const { mod, calls, restore } = loadJobServiceWith({
    noonOrders: async () => {
      const err = new Error('noon export timed out')
      throw err
    },
    report: { date: '2026-09-09', channels: [{ channel: 'amazon_uae' }], totals: {} },
  })
  try {
    const started = mod.startRefreshJob({ date: '2026-09-09' })
    const done = await waitForJob(mod, started.jobId)
    assert.equal(done.status, 'completed', 'the refresh as a whole still succeeds')
    assert.equal(done.sync.noon.status, 'error')
    assert.match(done.sync.noon.message, /noon export timed out/)
    assert.equal(done.sync.amazon_uae.status, 'ok')
    assert.equal(done.sync.amazon_ksa.status, 'ok')
    assert.equal(done.sync.noon_finance.status, 'ok')
    assert.equal(done.sync.life_smile.status, 'ok')
    assert.ok(done.report, 'the report is still rebuilt from whatever did succeed')
    assert.equal(calls.report.length, 1)
  } finally {
    restore()
  }
})

test('a Noon configuration error is reported as not_configured, not as a crash', async () => {
  const { mod, restore } = loadJobServiceWith({
    noonOrders: async () => {
      const err = new Error('NOON_API_ENABLED is off')
      err.code = 'NOON_NOT_CONFIGURED'
      throw err
    },
  })
  try {
    const done = await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    assert.equal(done.sync.noon.status, 'not_configured')
    assert.equal(done.sync.noon.code, 'NOON_NOT_CONFIGURED')
  } finally {
    restore()
  }
})

test('a website permission error keeps its SQLSTATE so the cause is diagnosable', async () => {
  const readError = Object.assign(new Error('permission denied for table orders'), {
    pgCode: '42501',
  })
  const { mod, restore } = loadJobServiceWith({ website: { readError } })
  try {
    const done = await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    assert.equal(done.sync.life_smile.status, 'error')
    assert.equal(done.sync.life_smile.ordersReadable, false)
    assert.match(done.sync.life_smile.message, /SQLSTATE 42501: permission denied for table orders/)
  } finally {
    restore()
  }
})

test('an unset website connection is not_configured and names the variable', async () => {
  const { mod, restore } = loadJobServiceWith({ website: { configured: false } })
  try {
    const done = await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    assert.equal(done.sync.life_smile.status, 'not_configured')
    assert.match(done.sync.life_smile.message, /LIFESMILE_WEBSITE_DATABASE_URL/)
  } finally {
    restore()
  }
})

test('a failure while rebuilding the report fails the job with its real message', async () => {
  const { mod, restore } = loadJobServiceWith({
    report: () => {
      throw new Error('exchange rate source unavailable')
    },
  })
  try {
    const done = await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    assert.equal(done.status, 'failed')
    assert.match(done.error, /exchange rate source unavailable/)
    assert.equal(done.sync.amazon_uae.status, 'ok', 'what did succeed is still reported')
  } finally {
    restore()
  }
})

test('Amazon is re-synced for the exact Dubai day, forced, with items', async () => {
  const { mod, calls, restore } = loadJobServiceWith({})
  try {
    await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    assert.deepEqual(calls.amazon.map((c) => c.marketplaceKey), ['uae', 'ksa'])
    for (const call of calls.amazon) {
      assert.equal(call.createdAfter.toISOString(), '2026-09-08T20:00:00.000Z')
      assert.equal(call.createdBefore.toISOString(), '2026-09-09T19:59:59.999Z')
      assert.equal(call.includeItems, true)
      // Amazon withholds OrderTotal while an order is Pending, so a refresh must bypass the
      // cooldown or a pending order's amount would stay wrong for ever.
      assert.equal(call.force, true)
      assert.equal(call.forceAllowed, true)
    }
  } finally {
    restore()
  }
})

test('the Amazon order report is pulled for the same Dubai day, per marketplace', async () => {
  // Without this step a day with still-Pending orders under-reports Amazon: the Orders API omits
  // OrderTotal and every item money field until Amazon authorises the payment, while this report
  // carries the price from the moment the order is placed.
  const { mod, calls, restore } = loadJobServiceWith({})
  try {
    const done = await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    assert.deepEqual(calls.amazonReport.map((c) => c.marketplaceKey), ['uae', 'ksa'])
    for (const call of calls.amazonReport) {
      assert.equal(call.dataStartTime.toISOString(), '2026-09-08T20:00:00.000Z')
      assert.equal(call.dataEndTime.toISOString(), '2026-09-09T20:00:00.000Z')
    }
    assert.equal(done.sync.amazon_uae_report.status, 'ok')
    assert.equal(done.sync.amazon_ksa_report.rowsSaved, 15)
  } finally {
    restore()
  }
})

test('a failed order report does not take the Amazon orders sync down with it', async () => {
  const { mod, restore } = loadJobServiceWith({
    amazonReport: async ({ marketplaceKey }) => {
      if (marketplaceKey === 'uae') throw new Error('report ended as FATAL')
      return { reportId: 'r2', reused: false, polls: 2, rowsParsed: 0, rowsSaved: 0, rowsRemoved: 0, uniqueOrders: 0, linesWithoutMoney: 0 }
    },
  })
  try {
    const done = await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    assert.equal(done.status, 'completed')
    assert.equal(done.sync.amazon_uae_report.status, 'error')
    assert.match(done.sync.amazon_uae_report.message, /report ended as FATAL/)
    assert.equal(done.sync.amazon_uae.status, 'ok', 'the orders sync is untouched')
    assert.equal(done.sync.amazon_ksa_report.status, 'ok')
  } finally {
    restore()
  }
})

test('skipping Amazon skips its order report too', async () => {
  const { mod, calls, restore } = loadJobServiceWith({})
  try {
    const done = await waitForJob(
      mod,
      mod.startRefreshJob({ date: '2026-09-09', skipAmazon: true }).jobId,
    )
    assert.equal(calls.amazonReport.length, 0)
    assert.equal(done.sync.amazon_uae_report.status, 'skipped')
    assert.equal(done.sync.amazon_ksa_report.status, 'skipped')
  } finally {
    restore()
  }
})

test('the Noon orders export overshoots backwards, so the Dubai boundary cannot clip an order', async () => {
  const { mod, calls, restore } = loadJobServiceWith({})
  try {
    await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    // 9 September in Dubai starts at 20:00 UTC on the 8th, and Noon filters the export by its own
    // calendar, so asking from the 7th guarantees the early hours of the Dubai day are inside the
    // window. `order_placed_at` then decides inclusion precisely.
    assert.deepEqual(calls.noonOrders[0], { fromYmd: '2026-09-07', toYmd: '2026-09-09' })
  } finally {
    restore()
  }
})

test("Noon's per-SKU sales report is pulled for the report date with a lower-case country", async () => {
  // Noon matches the country parameter case-sensitively and answers an upper-case "AE" with an empty
  // report rather than an error, which would silently price the day at nothing.
  const { mod, calls, restore } = loadJobServiceWith({})
  try {
    const done = await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    assert.deepEqual(calls.noonSkuSales, [
      { countryCode: 'ae', fromYmd: '2026-09-09', toYmd: '2026-09-09' },
    ])
    assert.equal(done.sync.noon_sku_sales.status, 'ok')
    assert.equal(done.sync.noon_sku_sales.rowsSaved, 9)
  } finally {
    restore()
  }
})

test('the Noon catalog export is pulled live, with a lower-case country', async () => {
  const { mod, calls, restore } = loadJobServiceWith({})
  try {
    const done = await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    assert.deepEqual(calls.noonCatalog, [{ countryCode: 'ae', noonStatus: 'live' }])
    assert.equal(done.sync.noon_catalog.status, 'ok')
    assert.equal(done.sync.noon_catalog.skusWithPrice, 521)
  } finally {
    restore()
  }
})

test('a failed Noon catalog export leaves the other Noon exports alone', async () => {
  const { mod, restore } = loadJobServiceWith({
    noonCatalog: async () => {
      throw new Error('noon catalog export failed')
    },
  })
  try {
    const done = await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    assert.equal(done.status, 'completed')
    assert.equal(done.sync.noon_catalog.status, 'error')
    assert.equal(done.sync.noon.status, 'ok')
    assert.equal(done.sync.noon_sku_sales.status, 'ok')
  } finally {
    restore()
  }
})

test('a failed Noon sales report leaves the orders and finance exports alone', async () => {
  const { mod, restore } = loadJobServiceWith({
    noonSkuSales: async () => {
      throw new Error('noon sales export timed out')
    },
  })
  try {
    const done = await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    assert.equal(done.status, 'completed')
    assert.equal(done.sync.noon_sku_sales.status, 'error')
    assert.match(done.sync.noon_sku_sales.message, /noon sales export timed out/)
    assert.equal(done.sync.noon.status, 'ok')
    assert.equal(done.sync.noon_finance.status, 'ok')
  } finally {
    restore()
  }
})

test('the Noon finance export reaches forward for settlements, never past today', async () => {
  const { mod, calls, restore } = loadJobServiceWith({})
  try {
    await waitForJob(mod, mod.startRefreshJob({ date: '2026-09-09' }).jobId)
    const { fromYmd, toYmd } = calls.noonFinance[0]
    assert.equal(fromYmd, '2026-09-09')
    assert.ok(toYmd >= fromYmd)
    assert.ok(
      toYmd <= new Date().toISOString().slice(0, 10),
      'Noon has no statements for the future, so asking for them is pointless',
    )
  } finally {
    restore()
  }
})

test('skip flags leave an integration untouched and say so', async () => {
  const { mod, calls, restore } = loadJobServiceWith({})
  try {
    const done = await waitForJob(
      mod,
      mod.startRefreshJob({ date: '2026-09-09', skipAmazon: true, skipNoon: true }).jobId,
    )
    assert.equal(calls.amazon.length, 0)
    assert.equal(calls.noonOrders.length, 0)
    assert.equal(calls.noonSkuSales.length, 0)
    assert.equal(calls.noonCatalog.length, 0)
    assert.equal(done.sync.amazon_uae.status, 'skipped')
    assert.equal(done.sync.noon.status, 'skipped')
    assert.equal(done.sync.noon_sku_sales.status, 'skipped')
    assert.equal(done.sync.noon_catalog.status, 'skipped')
    assert.equal(done.sync.life_smile.status, 'ok', 'skipping Amazon does not skip the website')
  } finally {
    restore()
  }
})

/** Minimal Express double: records what the handler answered. */
function fakeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
  return res
}

function loadControllerWith(jobService) {
  const restores = [
    stubModule('../src/services/dailyEcommerceReport/dailyEcommerceRefreshJobService', jobService),
    stubModule('../src/services/dailyEcommerceReport/dailyEcommerceReportService', {
      buildDailyEcommerceReport: async () => ({ channels: [], totals: {} }),
    }),
    stubModule('../src/services/dailyEcommerceReport/dailyEcommerceReportXlsxService', {
      buildDailyEcommerceReportXlsxBuffer: async () => Buffer.alloc(0),
    }),
  ]
  const mod = freshModule('../src/controllers/dailyEcommerceReportController')
  return { mod, restore: () => restores.forEach((r) => r()) }
}

test('POST refresh answers 202 with the job id and does not wait for the work', async () => {
  const started = []
  const { mod, restore } = loadControllerWith({
    startRefreshJob: (opts) => {
      started.push(opts)
      return { jobId: 'job-1', date: opts.date, status: 'queued' }
    },
    getRefreshJob: () => null,
  })
  try {
    const res = fakeRes()
    await mod.refreshDailyEcommerceReport({ body: { date: '2026-09-09' }, query: {} }, res)
    assert.equal(res.statusCode, 202, 'the response must not carry the finished report')
    assert.equal(res.body.jobId, 'job-1')
    assert.deepEqual(started, [{ date: '2026-09-09', skipAmazon: false, skipNoon: false }])
  } finally {
    restore()
  }
})

test('POST refresh rejects a malformed date before starting anything', async () => {
  let calls = 0
  const { mod, restore } = loadControllerWith({
    startRefreshJob: () => {
      calls += 1
      return { jobId: 'x', status: 'queued' }
    },
    getRefreshJob: () => null,
  })
  try {
    const res = fakeRes()
    await mod.refreshDailyEcommerceReport({ body: { date: '09/09/2026' }, query: {} }, res)
    assert.equal(res.statusCode, 400)
    assert.equal(calls, 0)
  } finally {
    restore()
  }
})

test('the status route hands back the job, report included once it is done', async () => {
  const finished = {
    jobId: 'job-1',
    status: 'completed',
    sync: { amazon_uae: { status: 'ok' } },
    report: { date: '2026-09-09', channels: [] },
  }
  const { mod, restore } = loadControllerWith({
    startRefreshJob: () => finished,
    getRefreshJob: (id) => (id === 'job-1' ? finished : null),
  })
  try {
    const res = fakeRes()
    await mod.getDailyEcommerceRefreshStatus({ params: { jobId: 'job-1' } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.report.date, '2026-09-09')
    assert.equal(res.body.sync.amazon_uae.status, 'ok')
  } finally {
    restore()
  }
})

test('an expired job id answers 404 with a code the page can act on', async () => {
  const { mod, restore } = loadControllerWith({
    startRefreshJob: () => ({ jobId: 'a', status: 'queued' }),
    getRefreshJob: () => null,
  })
  try {
    const res = fakeRes()
    await mod.getDailyEcommerceRefreshStatus({ params: { jobId: 'gone' } }, res)
    assert.equal(res.statusCode, 404)
    assert.equal(res.body.code, 'REFRESH_JOB_NOT_FOUND')
  } finally {
    restore()
  }
})

test('an unknown job id reads as missing rather than throwing', () => {
  const { mod, restore } = loadJobServiceWith({})
  try {
    assert.equal(mod.getRefreshJob('nope'), null)
    assert.equal(mod.getRefreshJob(''), null)
    assert.equal(mod.getRefreshJob(undefined), null)
  } finally {
    restore()
  }
})
