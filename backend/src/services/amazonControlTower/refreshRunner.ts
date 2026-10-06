'use strict'

/**
 * Runs Control Tower refresh jobs in the background with persistent state.
 *
 * - start(): claims a run (DB-enforced single active run per marketplace + job type), returns at once
 *   so the HTTP layer can answer 202, and executes the handler asynchronously.
 * - A heartbeat timer keeps `heartbeat_at` fresh; runs whose heartbeat stops are marked `interrupted`
 *   by markStaleRunsInterrupted (on boot, before each new claim, and on run/freshness reads).
 * - refresh_all claims one child run per step up front (so the UI can show every step and a
 *   standalone run of the same step cannot start in parallel) and executes them in order. A step
 *   already running elsewhere is recorded as `skipped`, never run twice.
 */

const crypto = require('crypto')
const os = require('os')
const { RUN_STATUS } = require('./refreshRunStore.ts')

const JOB_TYPES = Object.freeze({
  REFRESH_ALL: 'refresh_all',
  REFRESH_HEALTH: 'refresh_health',
  LISTINGS: 'listings',
  LISTING_STATUS: 'listing_status',
  SALES: 'sales',
  ROLLUP: 'rollup',
  FBA_INVENTORY: 'fba_inventory',
  WAREHOUSE_STOCK: 'warehouse_stock',
  INVENTORY_REPORTS: 'inventory_reports',
  REMOVAL_ORDERS: 'removal_orders',
  SALES_BACKFILL: 'sales_backfill',
})

const REFRESH_ALL_STEPS: { key: string; label: string }[] = [
  { key: JOB_TYPES.LISTINGS, label: 'Listings / SKU sync' },
  { key: JOB_TYPES.LISTING_STATUS, label: 'Amazon listing status' },
  { key: JOB_TYPES.SALES, label: 'Sales (order report) sync' },
  { key: JOB_TYPES.ROLLUP, label: 'Daily sales rollup' },
  { key: JOB_TYPES.FBA_INVENTORY, label: 'FBA inventory' },
  { key: JOB_TYPES.WAREHOUSE_STOCK, label: 'Warehouse stock' },
]

const REFRESH_HEALTH_STEPS: { key: string; label: string }[] = [
  { key: JOB_TYPES.LISTING_STATUS, label: 'Amazon listing status' },
  { key: JOB_TYPES.FBA_INVENTORY, label: 'FBA inventory' },
  { key: JOB_TYPES.INVENTORY_REPORTS, label: 'Inventory age, volumes and capacity usage' },
  { key: JOB_TYPES.REMOVAL_ORDERS, label: 'Removal orders' },
]

/** Composite jobs: one parent run with one claimed child run per step. */
const COMPOSITE_STEPS: Record<string, { key: string; label: string }[]> = {
  [JOB_TYPES.REFRESH_ALL]: REFRESH_ALL_STEPS,
  [JOB_TYPES.REFRESH_HEALTH]: REFRESH_HEALTH_STEPS,
}

function isCompositeJob(jobType: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMPOSITE_STEPS, jobType)
}
const FRESHNESS_STEP = { key: 'freshness', label: 'Data freshness' }

const DEFAULT_HEARTBEAT_MS = 20_000
const DEFAULT_STALE_MS = 5 * 60_000

type Run = {
  id: string
  marketplaceKey: string
  jobType: string
  status: string
  parentRunId: string | null
  [key: string]: any
}

type JobContext = {
  run: Run
  marketplaceKey: string
  params: Record<string, any>
  progress: (step: string, current?: number, total?: number) => void
  setRecords: (n: number) => void
}

type JobResult = { recordsProcessed?: number; metadata?: Record<string, any>; skippedReason?: string } | void

type JobHandler = (ctx: JobContext) => Promise<JobResult>

type StepState = {
  key: string
  label: string
  runId: string | null
  status: string
  error: string | null
  recordsProcessed: number
  startedAt: string | null
  finishedAt: string | null
}

type RunnerOptions = {
  store: any
  handlers: Record<string, JobHandler>
  computeFreshness?: (marketplaceKey: string) => Promise<any>
  processTag?: string
  heartbeatMs?: number
  staleMs?: number
  schedule?: (fn: () => void) => void
  newId?: () => string
  log?: { info: (...a: any[]) => void; error: (...a: any[]) => void }
}

type StartParams = {
  marketplaceKey: string
  jobType: string
  trigger?: 'manual' | 'scheduler'
  requestedBy?: string | null
  params?: Record<string, any>
}

type StartResult = {
  runIds: string[]
  status: string
  alreadyRunning: boolean
  run: Run | null
}

function errorText(err: any): string {
  if (!err) return 'Unknown error'
  const code = err.code ? `[${err.code}] ` : ''
  return `${code}${err.message || String(err)}`
}

function createRefreshRunner(options: RunnerOptions) {
  const store = options.store
  const handlers = options.handlers || {}
  const processTag = options.processTag || `${os.hostname()}:${process.pid}`
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  const schedule = options.schedule || ((fn: () => void) => setImmediate(fn))
  const newId = options.newId || (() => crypto.randomUUID())
  const log = options.log || { info: (...a: any[]) => console.info(...a), error: (...a: any[]) => console.error(...a) }
  /** Background executions in this process (tests await them via drain()). */
  const inFlight = new Set<Promise<unknown>>()

  /** Schedules background work and tracks it from the moment it is scheduled. */
  function launch(work: () => Promise<unknown>) {
    const p = new Promise<void>((resolve) => {
      schedule(() => {
        work()
          .catch((err) => log.error('[control-tower] background run crashed:', errorText(err)))
          .finally(() => resolve())
      })
    })
    inFlight.add(p)
    p.finally(() => inFlight.delete(p))
  }

  function isKnownJob(jobType: string) {
    return isCompositeJob(jobType) || typeof handlers[jobType] === 'function'
  }

  /** Executes one claimed run to a terminal status. Never throws. */
  async function execute(run: Run, params: Record<string, any> = {}): Promise<Run | null> {
    const handler = handlers[run.jobType]
    const started = await store.markRunning(run.id, processTag)
    if (!started) return store.getRun(run.id)

    let latest: { currentStep?: string; progressCurrent?: number; progressTotal?: number; recordsProcessed?: number } = {}
    let dirty = false
    let persist: Promise<unknown> = Promise.resolve()
    const flush = () => {
      if (!dirty) return persist
      dirty = false
      const patch = { ...latest }
      persist = persist.then(() => store.updateProgress(run.id, patch)).catch((e: any) => log.error('[control-tower] progress write failed', e?.message))
      return persist
    }
    const timer = setInterval(() => {
      if (dirty) flush()
      else persist = persist.then(() => store.heartbeat(run.id)).catch((e: any) => log.error('[control-tower] heartbeat failed', e?.message))
    }, heartbeatMs)
    if (typeof timer.unref === 'function') timer.unref()

    const ctx: JobContext = {
      run: started,
      marketplaceKey: run.marketplaceKey,
      params,
      progress(step, current, total) {
        const stepChanged = step !== latest.currentStep
        latest = { ...latest, currentStep: step }
        if (current != null) latest.progressCurrent = Math.max(0, Math.round(current))
        if (total != null) latest.progressTotal = Math.max(0, Math.round(total))
        dirty = true
        if (stepChanged) flush()
      },
      setRecords(n) {
        latest = { ...latest, recordsProcessed: Math.max(0, Math.round(n)) }
        dirty = true
      },
    }

    let finalPatch: any
    try {
      if (typeof handler !== 'function') throw new Error(`No handler registered for job type "${run.jobType}"`)
      const result = (await handler(ctx)) || {}
      if (result.skippedReason) {
        finalPatch = { status: RUN_STATUS.SKIPPED, errorMessage: result.skippedReason, metadata: result.metadata, currentStep: 'Skipped' }
      } else {
        finalPatch = {
          status: RUN_STATUS.SUCCEEDED,
          errorMessage: null,
          recordsProcessed: result.recordsProcessed ?? latest.recordsProcessed ?? 0,
          metadata: result.metadata,
          currentStep: 'Completed',
        }
      }
    } catch (err: any) {
      log.error(`[control-tower] ${run.marketplaceKey}/${run.jobType} run ${run.id} failed:`, errorText(err))
      finalPatch = {
        status: RUN_STATUS.FAILED,
        errorMessage: errorText(err),
        metadata: err?.metadata,
        recordsProcessed: latest.recordsProcessed,
        currentStep: latest.currentStep ? `Failed during: ${latest.currentStep}` : 'Failed',
      }
    } finally {
      clearInterval(timer)
      await flush()
      await persist
    }
    return store.finishRun(run.id, finalPatch)
  }

  async function startComposite(input: StartParams): Promise<StartResult> {
    const compositeSteps = COMPOSITE_STEPS[input.jobType]
    const parentId = newId()
    const claim = await store.claimRun({
      id: parentId,
      marketplaceKey: input.marketplaceKey,
      jobType: input.jobType,
      triggerSource: input.trigger || 'manual',
      requestedBy: input.requestedBy || null,
      processTag,
      metadata: { steps: [] },
    })
    if (!claim.claimed) {
      const existing = claim.existing
      const children = existing ? await store.listChildRuns(existing.id) : []
      return {
        runIds: existing ? [existing.id, ...children.map((c: Run) => c.id)] : [],
        status: existing ? existing.status : RUN_STATUS.QUEUED,
        alreadyRunning: true,
        run: existing,
      }
    }

    const steps: StepState[] = []
    const childRuns: Run[] = []
    for (const step of compositeSteps) {
      const childInput = {
        id: newId(),
        marketplaceKey: input.marketplaceKey,
        jobType: step.key,
        triggerSource: 'parent',
        parentRunId: parentId,
        requestedBy: input.requestedBy || null,
        processTag,
      }
      const childClaim = await store.claimRun(childInput)
      if (childClaim.claimed) {
        childRuns.push(childClaim.run)
        steps.push({ key: step.key, label: step.label, runId: childClaim.run.id, status: RUN_STATUS.QUEUED, error: null, recordsProcessed: 0, startedAt: null, finishedAt: null })
      } else {
        const reason = childClaim.existing
          ? `Skipped: another ${step.key} run is already ${childClaim.existing.status} (${childClaim.existing.id})`
          : `Skipped: another ${step.key} run is already active`
        const skipped = await store.insertSkippedRun(childInput, reason)
        childRuns.push(skipped)
        steps.push({ key: step.key, label: step.label, runId: skipped.id, status: RUN_STATUS.SKIPPED, error: reason, recordsProcessed: 0, startedAt: null, finishedAt: null })
      }
    }
    steps.push({ key: FRESHNESS_STEP.key, label: FRESHNESS_STEP.label, runId: null, status: RUN_STATUS.QUEUED, error: null, recordsProcessed: 0, startedAt: null, finishedAt: null })

    const parent: Run = claim.run
    launch(() => executeRefreshAll(parent, childRuns, steps, input.params || {}))
    return {
      runIds: [parentId, ...childRuns.map((c) => c.id)],
      status: RUN_STATUS.QUEUED,
      alreadyRunning: false,
      run: parent,
    }
  }

  async function executeRefreshAll(parent: Run, childRuns: Run[], steps: StepState[], params: Record<string, any>) {
    const started = await store.markRunning(parent.id, processTag)
    if (!started) return
    const total = steps.length
    const timer = setInterval(() => {
      store.heartbeat(parent.id).catch((e: any) => log.error('[control-tower] heartbeat failed', e?.message))
    }, heartbeatMs)
    if (typeof timer.unref === 'function') timer.unref()

    const writeSteps = (index: number, label: string) =>
      store.updateProgress(parent.id, {
        currentStep: `Step ${index + 1}/${total}: ${label}`,
        progressCurrent: index,
        progressTotal: total,
        metadata: { steps },
      })

    let records = 0
    let freshness: any = null
    try {
      for (let i = 0; i < childRuns.length; i += 1) {
        const child = childRuns[i]
        const step = steps[i]
        if (step.status === RUN_STATUS.SKIPPED) {
          await writeSteps(i, `${step.label} (skipped)`)
          continue
        }
        step.status = RUN_STATUS.RUNNING
        step.startedAt = new Date().toISOString()
        await writeSteps(i, step.label)
        const finished = await execute(child, params[step.key] || {})
        step.status = finished ? finished.status : RUN_STATUS.FAILED
        step.error = finished ? finished.errorMessage : 'Run record disappeared'
        step.recordsProcessed = finished ? finished.recordsProcessed || 0 : 0
        step.finishedAt = new Date().toISOString()
        records += step.recordsProcessed
      }

      const fIndex = steps.length - 1
      const fStep = steps[fIndex]
      fStep.status = RUN_STATUS.RUNNING
      fStep.startedAt = new Date().toISOString()
      await writeSteps(fIndex, fStep.label)
      try {
        freshness = options.computeFreshness ? await options.computeFreshness(parent.marketplaceKey) : null
        fStep.status = RUN_STATUS.SUCCEEDED
      } catch (err) {
        fStep.status = RUN_STATUS.FAILED
        fStep.error = errorText(err)
      }
      fStep.finishedAt = new Date().toISOString()
    } catch (err) {
      log.error(`[control-tower] ${parent.jobType} crashed:`, errorText(err))
      const running = steps.find((s) => s.status === RUN_STATUS.RUNNING)
      if (running) {
        running.status = RUN_STATUS.FAILED
        running.error = errorText(err)
      }
    } finally {
      clearInterval(timer)
    }

    const failed = steps.filter((s) => s.status === RUN_STATUS.FAILED || s.status === RUN_STATUS.INTERRUPTED)
    await store.updateProgress(parent.id, { progressCurrent: total, progressTotal: total, metadata: { steps } })
    await store.finishRun(parent.id, {
      status: failed.length ? RUN_STATUS.FAILED : RUN_STATUS.SUCCEEDED,
      errorMessage: failed.length ? failed.map((s) => `${s.label}: ${s.error || s.status}`).join(' | ') : null,
      recordsProcessed: records,
      metadata: { steps, freshness },
      currentStep: failed.length ? `Completed with ${failed.length} failed step(s)` : 'Completed',
    })
  }

  async function start(input: StartParams): Promise<StartResult> {
    if (!isKnownJob(input.jobType)) {
      const err: any = new Error(`Unknown Control Tower job type "${input.jobType}"`)
      err.status = 400
      err.code = 'UNKNOWN_JOB_TYPE'
      throw err
    }
    await store.markStaleRunsInterrupted({ staleMs })
    if (isCompositeJob(input.jobType)) return startComposite(input)

    const claim = await store.claimRun({
      id: newId(),
      marketplaceKey: input.marketplaceKey,
      jobType: input.jobType,
      triggerSource: input.trigger || 'manual',
      requestedBy: input.requestedBy || null,
      processTag,
      metadata: input.params && Object.keys(input.params).length ? { params: input.params } : {},
    })
    if (!claim.claimed) {
      return {
        runIds: claim.existing ? [claim.existing.id] : [],
        status: claim.existing ? claim.existing.status : RUN_STATUS.QUEUED,
        alreadyRunning: true,
        run: claim.existing,
      }
    }
    launch(() => execute(claim.run, input.params || {}))
    return { runIds: [claim.run.id], status: RUN_STATUS.QUEUED, alreadyRunning: false, run: claim.run }
  }

  /**
   * Reads call this so a run orphaned by a crash/restart (heartbeat stopped) turns `interrupted`
   * instead of keeping the UI's refresh buttons locked until the next claim or boot.
   */
  async function sweepStaleRuns(): Promise<number> {
    return store.markStaleRunsInterrupted({ staleMs })
  }

  /** Run + its children (composite steps) for polling. */
  async function getRunWithChildren(id: string) {
    await sweepStaleRuns()
    const run = await store.getRun(id)
    if (!run) return null
    const children = isCompositeJob(run.jobType) ? await store.listChildRuns(run.id) : []
    return { ...run, children }
  }

  /** Boot-time cleanup: anything left queued/running without a heartbeat is `interrupted`. */
  async function recoverInterruptedRuns(): Promise<number> {
    return store.markStaleRunsInterrupted({ staleMs: Math.max(heartbeatMs * 4, 60_000) })
  }

  async function drain() {
    while (inFlight.size) await Promise.allSettled([...inFlight])
  }

  return { start, execute, getRunWithChildren, sweepStaleRuns, recoverInterruptedRuns, drain, processTag }
}

module.exports = {
  JOB_TYPES,
  REFRESH_ALL_STEPS,
  REFRESH_HEALTH_STEPS,
  COMPOSITE_STEPS,
  isCompositeJob,
  FRESHNESS_STEP,
  createRefreshRunner,
}
