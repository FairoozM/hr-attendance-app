'use strict'

/**
 * Durable background jobs for Purchase Planning (Zoho enrichment of pending low-stock SKUs).
 *
 * Job state lives in purchase_planning_jobs, so a restart or another instance can see it. A partial
 * unique index allows at most one queued and one running job per kind across all instances. A running
 * job heartbeats; one whose heartbeat stops (crash/restart) is queued again, up to maxAttempts.
 * Enrichment only rewrites pending rows from Zoho, so running an interrupted job again is safe.
 */

const crypto = require('crypto')

type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

interface JobRow {
  id: number
  kind: string
  status: JobStatus
  attempts: number
  boot_id: string | null
  progress: string | null
  summary: Record<string, unknown> | null
  error: string | null
  requested_at: Date | string | null
  started_at: Date | string | null
  heartbeat_at: Date | string | null
  finished_at: Date | string | null
}

interface StaleJob extends JobRow {
  timed_out: boolean
}

interface RecoverOptions {
  staleMs: number
  maxRuntimeMs: number
  maxAttempts: number
  skipId: number | null
}

interface JobStore {
  enqueue(): Promise<boolean>
  claim(bootId: string): Promise<JobRow | null>
  heartbeat(id: number, bootId: string, progress: string | null): Promise<boolean>
  finish(id: number, bootId: string, summary: Record<string, unknown> | null): Promise<void>
  fail(id: number, bootId: string | null, error: string): Promise<void>
  requeue(id: number, progress: string): Promise<boolean>
  listStale(options: RecoverOptions): Promise<StaleJob[]>
  listRecent(limit: number): Promise<JobRow[]>
  isActive(): Promise<boolean>
}

interface JobProgressContext {
  onProgress: (text: string) => Promise<void> | void
}

interface JobRunnerOptions {
  store: JobStore
  run: (ctx: JobProgressContext) => Promise<Record<string, unknown> | null | undefined>
  bootId?: string
  heartbeatMs?: number
  staleMs?: number
  maxRuntimeMs?: number
  maxAttempts?: number
  log?: Pick<Console, 'error' | 'warn'>
}

interface JobStatusView {
  running: boolean
  queuedAgain: boolean
  status: JobStatus | null
  progress: string | null
  startedAt: string | null
  attempts: number
  lastError: string | null
  lastCompletedAt: string | null
  lastSummary: { refreshed: number; matched: number; unmatched: number } | null
}

const UNIQUE_VIOLATION = '23505'
const JOB_RETENTION_DAYS = 30

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === UNIQUE_VIOLATION)
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function timeMs(value: Date | string | null | undefined): number {
  const iso = toIso(value)
  return iso ? Date.parse(iso) : 0
}

async function ensurePurchasePlanningJobsTable(query: QueryFn): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS purchase_planning_jobs (
      id SERIAL PRIMARY KEY,
      kind VARCHAR(40) NOT NULL,
      status VARCHAR(20) NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      boot_id VARCHAR(64),
      progress TEXT,
      summary JSONB,
      error TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )
  `)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_planning_jobs_active
    ON purchase_planning_jobs (kind, status)
    WHERE status IN ('queued', 'running')
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_planning_jobs_kind_requested
    ON purchase_planning_jobs (kind, requested_at DESC)
  `)
  await query(
    `DELETE FROM purchase_planning_jobs WHERE status IN ('completed', 'failed') AND requested_at < NOW() - make_interval(days => $1)`,
    [JOB_RETENTION_DAYS]
  )
}

function createPgJobStore(query: QueryFn, kind: string): JobStore {
  return {
    async enqueue() {
      const result = await query(
        `
          INSERT INTO purchase_planning_jobs (kind, status, progress)
          VALUES ($1, 'queued', 'Waiting to start')
          ON CONFLICT DO NOTHING
          RETURNING id
        `,
        [kind]
      )
      return result.rows.length > 0
    },

    async claim(bootId) {
      try {
        const result = await query(
          `
            UPDATE purchase_planning_jobs
            SET status = 'running',
                boot_id = $2,
                attempts = attempts + 1,
                started_at = NOW(),
                heartbeat_at = NOW(),
                progress = 'Starting',
                error = NULL
            WHERE id = (
              SELECT id FROM purchase_planning_jobs
              WHERE kind = $1 AND status = 'queued'
              ORDER BY requested_at, id
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            RETURNING *
          `,
          [kind, bootId]
        )
        return result.rows[0] || null
      } catch (err) {
        if (isUniqueViolation(err)) return null
        throw err
      }
    },

    async heartbeat(id, bootId, progress) {
      const result = await query(
        `
          UPDATE purchase_planning_jobs
          SET heartbeat_at = NOW(), progress = COALESCE($3, progress)
          WHERE id = $1 AND boot_id = $2 AND status = 'running'
          RETURNING id
        `,
        [id, bootId, progress]
      )
      return result.rows.length > 0
    },

    async finish(id, bootId, summary) {
      await query(
        `
          UPDATE purchase_planning_jobs
          SET status = 'completed', summary = $3, progress = NULL, finished_at = NOW(), heartbeat_at = NOW()
          WHERE id = $1 AND boot_id = $2 AND status = 'running'
        `,
        [id, bootId, summary == null ? null : JSON.stringify(summary)]
      )
    },

    async fail(id, bootId, error) {
      await query(
        `
          UPDATE purchase_planning_jobs
          SET status = 'failed', error = $3, progress = NULL, finished_at = NOW()
          WHERE id = $1 AND status = 'running' AND ($2::text IS NULL OR boot_id = $2)
        `,
        [id, bootId, error.slice(0, 2000)]
      )
    },

    async requeue(id, progress) {
      try {
        const result = await query(
          `
            UPDATE purchase_planning_jobs
            SET status = 'queued', boot_id = NULL, heartbeat_at = NULL, progress = $2
            WHERE id = $1 AND status = 'running'
            RETURNING id
          `,
          [id, progress]
        )
        return result.rows.length > 0
      } catch (err) {
        if (isUniqueViolation(err)) return false
        throw err
      }
    },

    async listStale({ staleMs, maxRuntimeMs, skipId }) {
      const result = await query(
        `
          SELECT *, (started_at < NOW() - make_interval(secs => $3)) AS timed_out
          FROM purchase_planning_jobs
          WHERE kind = $1
            AND status = 'running'
            AND ($4::int IS NULL OR id <> $4)
            AND (
              heartbeat_at IS NULL
              OR heartbeat_at < NOW() - make_interval(secs => $2)
              OR started_at < NOW() - make_interval(secs => $3)
            )
        `,
        [kind, staleMs / 1000, maxRuntimeMs / 1000, skipId]
      )
      return result.rows
    },

    async listRecent(limit) {
      const result = await query(
        `SELECT * FROM purchase_planning_jobs WHERE kind = $1 ORDER BY requested_at DESC, id DESC LIMIT $2`,
        [kind, limit]
      )
      return result.rows
    },

    async isActive() {
      const result = await query(
        `SELECT 1 FROM purchase_planning_jobs WHERE kind = $1 AND status IN ('queued', 'running') LIMIT 1`,
        [kind]
      )
      return result.rows.length > 0
    },
  }
}

function summarizeStatus(rows: JobRow[]): JobStatusView {
  const running = rows.find((row) => row.status === 'running') || null
  const queued = rows.find((row) => row.status === 'queued') || null
  const current = running || queued
  const lastCompleted = rows.find((row) => row.status === 'completed') || null
  const lastFailed = rows.find((row) => row.status === 'failed') || null
  const failedIsNewest =
    lastFailed && (!lastCompleted || timeMs(lastFailed.finished_at) >= timeMs(lastCompleted.finished_at))
  const summary = lastCompleted?.summary || null

  return {
    running: Boolean(current),
    queuedAgain: Boolean(running && queued),
    status: current?.status || rows[0]?.status || null,
    progress: current?.progress || null,
    startedAt: toIso(current?.started_at),
    attempts: current?.attempts || 0,
    lastError: !current && failedIsNewest ? lastFailed?.error || null : null,
    lastCompletedAt: toIso(lastCompleted?.finished_at),
    lastSummary: summary
      ? {
          refreshed: Number(summary.refreshed || 0),
          matched: Number(summary.matched || 0),
          unmatched: Number(summary.unmatched || 0),
        }
      : null,
  }
}

function createJobRunner({
  store,
  run,
  bootId = crypto.randomUUID(),
  heartbeatMs = 15_000,
  staleMs = 60_000,
  maxRuntimeMs = 20 * 60 * 1000,
  maxAttempts = 3,
  log = console,
}: JobRunnerOptions) {
  let loop: Promise<void> | null = null
  let activeJobId: number | null = null

  async function recover(): Promise<number> {
    const stale = await store.listStale({ staleMs, maxRuntimeMs, maxAttempts, skipId: activeJobId })
    for (const job of stale) {
      if (job.timed_out) {
        await store.fail(
          job.id,
          null,
          `Zoho enrichment timed out after ${Math.round(maxRuntimeMs / 60000)} minutes (likely the Zoho sales report). Click Refresh Zoho Data to retry.`
        )
      } else if (job.attempts >= maxAttempts) {
        await store.fail(
          job.id,
          null,
          `Zoho enrichment was interrupted ${job.attempts} times. Click Refresh Zoho Data to retry.`
        )
      } else if (!(await store.requeue(job.id, 'Resuming after a server restart'))) {
        await store.fail(job.id, null, 'Interrupted by a server restart; a newer run is already queued.')
      }
    }
    return stale.length
  }

  async function execute(job: JobRow): Promise<void> {
    activeJobId = job.id
    const beat = setInterval(() => {
      store.heartbeat(job.id, bootId, null).catch(() => {})
    }, heartbeatMs)
    if (typeof beat.unref === 'function') beat.unref()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `Zoho enrichment timed out after ${Math.round(maxRuntimeMs / 60000)} minutes (likely the Zoho sales report). Click Refresh Zoho Data to retry.`
          )
        )
      }, maxRuntimeMs)
      if (typeof timer.unref === 'function') timer.unref()
    })

    try {
      const onProgress = (text: string) => store.heartbeat(job.id, bootId, text).then(() => undefined, () => undefined)
      const summary = await Promise.race([run({ onProgress }), timeout])
      await store.finish(job.id, bootId, summary || null)
    } catch (err) {
      const message = (err && (err as Error).message) || String(err)
      log.error('[purchase-planning] background Zoho enrichment failed:', err)
      await store.fail(job.id, bootId, message).catch((failErr: unknown) => {
        log.error('[purchase-planning] could not record enrichment failure:', failErr)
      })
    } finally {
      clearInterval(beat)
      if (timer) clearTimeout(timer)
      activeJobId = null
    }
  }

  /** Runs queued jobs on this instance until none are left. Safe to call repeatedly. */
  function kick(): Promise<void> {
    if (loop) return loop
    loop = (async () => {
      try {
        for (;;) {
          await recover()
          const job = await store.claim(bootId)
          if (!job) break
          await execute(job)
        }
      } catch (err) {
        log.error('[purchase-planning] background job loop failed:', err)
      } finally {
        loop = null
      }
    })()
    return loop
  }

  async function getStatus(): Promise<JobStatusView> {
    await recover()
    const rows = await store.listRecent(10)
    if (!loop && rows.some((row) => row.status === 'queued')) void kick()
    return summarizeStatus(rows)
  }

  async function queue(): Promise<JobStatusView> {
    await store.enqueue()
    void kick()
    return getStatus()
  }

  async function isActive(): Promise<boolean> {
    await recover()
    const active = await store.isActive()
    if (active && !loop) void kick()
    return active
  }

  return {
    bootId,
    queue,
    kick,
    getStatus,
    isActive,
    recover,
    /** Test helper: resolves when this instance has no job loop running. */
    idle: (): Promise<void> => loop || Promise.resolve(),
  }
}

module.exports = {
  ensurePurchasePlanningJobsTable,
  createPgJobStore,
  createJobRunner,
  summarizeStatus,
}
