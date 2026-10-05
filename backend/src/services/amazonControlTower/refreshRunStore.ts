'use strict'

/**
 * Persistent state for Control Tower refresh jobs (`amazon_refresh_runs`, `amazon_refresh_schedules`).
 *
 * Duplicate prevention is enforced by the database: a partial unique index allows only one
 * queued/running run per (marketplace, job type), so two instances racing to start the same job
 * cannot both win. Unrelated job types never block each other.
 *
 * `createMemoryRefreshStore` mirrors the same rules in memory for unit tests.
 */

const RUN_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  INTERRUPTED: 'interrupted',
})

const ACTIVE_STATUSES = [RUN_STATUS.QUEUED, RUN_STATUS.RUNNING]
const TERMINAL_STATUSES = [RUN_STATUS.SUCCEEDED, RUN_STATUS.FAILED, RUN_STATUS.SKIPPED, RUN_STATUS.INTERRUPTED]

type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'interrupted'
type TriggerSource = 'manual' | 'scheduler' | 'parent'

type RefreshRun = {
  id: string
  marketplaceKey: string
  jobType: string
  triggerSource: TriggerSource
  parentRunId: string | null
  status: RunStatus
  currentStep: string | null
  progressCurrent: number
  progressTotal: number
  recordsProcessed: number
  errorMessage: string | null
  metadata: Record<string, any>
  requestedBy: string | null
  processTag: string | null
  queuedAt: string
  startedAt: string | null
  heartbeatAt: string | null
  finishedAt: string | null
  durationMs: number | null
}

type NewRun = {
  id: string
  marketplaceKey: string
  jobType: string
  triggerSource?: TriggerSource
  parentRunId?: string | null
  requestedBy?: string | null
  processTag?: string | null
  metadata?: Record<string, any>
}

type ClaimResult = { claimed: true; run: RefreshRun } | { claimed: false; existing: RefreshRun | null }

type ProgressPatch = {
  currentStep?: string | null
  progressCurrent?: number
  progressTotal?: number
  recordsProcessed?: number
  metadata?: Record<string, any>
}

type FinishPatch = {
  status: 'succeeded' | 'failed' | 'skipped' | 'interrupted'
  errorMessage?: string | null
  recordsProcessed?: number
  metadata?: Record<string, any>
  currentStep?: string | null
}

type Schedule = {
  id: number
  marketplaceKey: string
  jobType: string
  intervalMinutes: number
  enabled: boolean
  nextRunAt: string | null
  lastRunId: string | null
  lastRunAt: string | null
  lastStatus: string | null
}

type JobRunSummary = {
  jobType: string
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  activeRun: RefreshRun | null
}

type DbLike = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }

const MAX_ERROR_LENGTH = 2000

function truncateError(message: unknown): string | null {
  if (message == null) return null
  const text = String(message)
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text
}

function iso(value: unknown): string | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function mapRunRow(row: any): RefreshRun | null {
  if (!row) return null
  return {
    id: String(row.id),
    marketplaceKey: row.marketplace_key,
    jobType: row.job_type,
    triggerSource: row.trigger_source,
    parentRunId: row.parent_run_id ? String(row.parent_run_id) : null,
    status: row.status,
    currentStep: row.current_step ?? null,
    progressCurrent: Number(row.progress_current) || 0,
    progressTotal: Number(row.progress_total) || 0,
    recordsProcessed: Number(row.records_processed) || 0,
    errorMessage: row.error_message ?? null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    requestedBy: row.requested_by ?? null,
    processTag: row.process_tag ?? null,
    queuedAt: iso(row.queued_at) as string,
    startedAt: iso(row.started_at),
    heartbeatAt: iso(row.heartbeat_at),
    finishedAt: iso(row.finished_at),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
  }
}

function mapScheduleRow(row: any): Schedule {
  return {
    id: Number(row.id),
    marketplaceKey: row.marketplace_key,
    jobType: row.job_type,
    intervalMinutes: Number(row.interval_minutes),
    enabled: Boolean(row.enabled),
    nextRunAt: iso(row.next_run_at),
    lastRunId: row.last_run_id ? String(row.last_run_id) : null,
    lastRunAt: iso(row.last_run_at),
    lastStatus: row.last_status ?? null,
  }
}

const RUN_COLUMNS = `id, marketplace_key, job_type, trigger_source, parent_run_id, status, current_step,
  progress_current, progress_total, records_processed, error_message, metadata, requested_by,
  process_tag, queued_at, started_at, heartbeat_at, finished_at, duration_ms`

function createPgRefreshStore(db: DbLike) {
  const q = (text: string, params: unknown[] = []) => db.query(text, params)

  async function getRun(id: string): Promise<RefreshRun | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null
    const r = await q(`SELECT ${RUN_COLUMNS} FROM amazon_refresh_runs WHERE id = $1`, [id])
    return mapRunRow(r.rows[0])
  }

  async function findActiveRun(marketplaceKey: string, jobType: string): Promise<RefreshRun | null> {
    const r = await q(
      `SELECT ${RUN_COLUMNS} FROM amazon_refresh_runs
       WHERE marketplace_key = $1 AND job_type = $2 AND status IN ('queued', 'running')
       ORDER BY queued_at DESC LIMIT 1`,
      [marketplaceKey, jobType]
    )
    return mapRunRow(r.rows[0])
  }

  async function claimRun(run: NewRun): Promise<ClaimResult> {
    const r = await q(
      `INSERT INTO amazon_refresh_runs (
         id, marketplace_key, job_type, trigger_source, parent_run_id, status, requested_by, process_tag, metadata, current_step
       ) VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, $8::jsonb, 'Queued')
       ON CONFLICT (marketplace_key, job_type) WHERE status IN ('queued', 'running') DO NOTHING
       RETURNING ${RUN_COLUMNS}`,
      [
        run.id,
        run.marketplaceKey,
        run.jobType,
        run.triggerSource || 'manual',
        run.parentRunId || null,
        run.requestedBy || null,
        run.processTag || null,
        JSON.stringify(run.metadata || {}),
      ]
    )
    const claimed = mapRunRow(r.rows[0])
    if (claimed) return { claimed: true, run: claimed }
    return { claimed: false, existing: await findActiveRun(run.marketplaceKey, run.jobType) }
  }

  async function insertSkippedRun(run: NewRun, reason: string): Promise<RefreshRun> {
    const r = await q(
      `INSERT INTO amazon_refresh_runs (
         id, marketplace_key, job_type, trigger_source, parent_run_id, status, requested_by, process_tag,
         metadata, error_message, current_step, finished_at, duration_ms
       ) VALUES ($1, $2, $3, $4, $5, 'skipped', $6, $7, $8::jsonb, $9, 'Skipped', NOW(), 0)
       RETURNING ${RUN_COLUMNS}`,
      [
        run.id,
        run.marketplaceKey,
        run.jobType,
        run.triggerSource || 'manual',
        run.parentRunId || null,
        run.requestedBy || null,
        run.processTag || null,
        JSON.stringify(run.metadata || {}),
        truncateError(reason),
      ]
    )
    return mapRunRow(r.rows[0]) as RefreshRun
  }

  async function markRunning(id: string, processTag: string | null): Promise<RefreshRun | null> {
    const r = await q(
      `UPDATE amazon_refresh_runs
       SET status = 'running', started_at = NOW(), heartbeat_at = NOW(), process_tag = COALESCE($2, process_tag),
           current_step = 'Starting', updated_at = NOW()
       WHERE id = $1 AND status = 'queued'
       RETURNING ${RUN_COLUMNS}`,
      [id, processTag]
    )
    return mapRunRow(r.rows[0])
  }

  async function updateProgress(id: string, patch: ProgressPatch): Promise<void> {
    await q(
      `UPDATE amazon_refresh_runs
       SET current_step = COALESCE($2, current_step),
           progress_current = COALESCE($3, progress_current),
           progress_total = COALESCE($4, progress_total),
           records_processed = COALESCE($5, records_processed),
           metadata = CASE WHEN $6::jsonb IS NULL THEN metadata ELSE metadata || $6::jsonb END,
           heartbeat_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [
        id,
        patch.currentStep ?? null,
        patch.progressCurrent ?? null,
        patch.progressTotal ?? null,
        patch.recordsProcessed ?? null,
        patch.metadata ? JSON.stringify(patch.metadata) : null,
      ]
    )
  }

  /** Keeps the run (and children queued behind it) from being treated as abandoned. */
  async function heartbeat(id: string): Promise<void> {
    await q(
      `UPDATE amazon_refresh_runs SET heartbeat_at = NOW(), updated_at = NOW()
       WHERE (id = $1 AND status = 'running') OR (parent_run_id = $1 AND status = 'queued')`,
      [id]
    )
  }

  async function finishRun(id: string, patch: FinishPatch): Promise<RefreshRun | null> {
    const r = await q(
      `UPDATE amazon_refresh_runs
       SET status = $2,
           error_message = $3,
           records_processed = COALESCE($4, records_processed),
           metadata = CASE WHEN $5::jsonb IS NULL THEN metadata ELSE metadata || $5::jsonb END,
           current_step = COALESCE($6, current_step),
           finished_at = NOW(),
           duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, queued_at))) * 1000)::int),
           heartbeat_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status IN ('queued', 'running')
       RETURNING ${RUN_COLUMNS}`,
      [
        id,
        patch.status,
        truncateError(patch.errorMessage),
        patch.recordsProcessed ?? null,
        patch.metadata ? JSON.stringify(patch.metadata) : null,
        patch.currentStep ?? null,
      ]
    )
    return mapRunRow(r.rows[0])
  }

  /** Queued/running runs whose heartbeat stopped (process died, deploy, crash) become `interrupted`. */
  async function markStaleRunsInterrupted({ staleMs }: { staleMs: number }): Promise<number> {
    const r = await q(
      `UPDATE amazon_refresh_runs
       SET status = 'interrupted',
           error_message = COALESCE(error_message, 'Interrupted: no heartbeat (server restarted or job crashed)'),
           finished_at = NOW(),
           duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, queued_at))) * 1000)::int),
           updated_at = NOW()
       WHERE status IN ('queued', 'running')
         AND COALESCE(heartbeat_at, started_at, queued_at) < NOW() - make_interval(secs => $1)`,
      [Math.max(1, Math.round(staleMs / 1000))]
    )
    return r.rowCount || 0
  }

  async function listChildRuns(parentRunId: string): Promise<RefreshRun[]> {
    const r = await q(
      `SELECT ${RUN_COLUMNS} FROM amazon_refresh_runs WHERE parent_run_id = $1 ORDER BY queued_at ASC, id ASC`,
      [parentRunId]
    )
    return r.rows.map((row) => mapRunRow(row) as RefreshRun)
  }

  async function listRecentRuns(marketplaceKey: string, limit = 20): Promise<RefreshRun[]> {
    const r = await q(
      `SELECT ${RUN_COLUMNS} FROM amazon_refresh_runs
       WHERE marketplace_key = $1 AND parent_run_id IS NULL
       ORDER BY queued_at DESC LIMIT $2`,
      [marketplaceKey, Math.min(Math.max(1, limit), 100)]
    )
    return r.rows.map((row) => mapRunRow(row) as RefreshRun)
  }

  async function summarizeJobRuns(marketplaceKey: string, jobTypes: string[]): Promise<JobRunSummary[]> {
    const r = await q(
      `SELECT jt.job_type,
              (SELECT MAX(finished_at) FROM amazon_refresh_runs s
                 WHERE s.marketplace_key = $1 AND s.job_type = jt.job_type AND s.status = 'succeeded') AS last_success_at,
              f.finished_at AS last_failure_at,
              f.error_message AS last_error
       FROM unnest($2::text[]) AS jt(job_type)
       LEFT JOIN LATERAL (
         SELECT finished_at, error_message FROM amazon_refresh_runs x
         WHERE x.marketplace_key = $1 AND x.job_type = jt.job_type AND x.status IN ('failed', 'interrupted')
         ORDER BY finished_at DESC NULLS LAST LIMIT 1
       ) f ON TRUE`,
      [marketplaceKey, jobTypes]
    )
    const out: JobRunSummary[] = []
    for (const row of r.rows) {
      out.push({
        jobType: row.job_type,
        lastSuccessAt: iso(row.last_success_at),
        lastFailureAt: iso(row.last_failure_at),
        lastError: row.last_error ?? null,
        activeRun: await findActiveRun(marketplaceKey, row.job_type),
      })
    }
    return out
  }

  async function listSchedules(marketplaceKey?: string): Promise<Schedule[]> {
    const r = marketplaceKey
      ? await q(`SELECT * FROM amazon_refresh_schedules WHERE marketplace_key = $1 ORDER BY job_type`, [marketplaceKey])
      : await q(`SELECT * FROM amazon_refresh_schedules ORDER BY marketplace_key, job_type`)
    return r.rows.map(mapScheduleRow)
  }

  /** Conditional claim (same idea as notification_sync_state): only one instance advances a due schedule. */
  async function claimDueSchedule(id: number): Promise<Schedule | null> {
    const r = await q(
      `UPDATE amazon_refresh_schedules
       SET next_run_at = NOW() + make_interval(mins => interval_minutes), updated_at = NOW()
       WHERE id = $1 AND enabled = TRUE AND (next_run_at IS NULL OR next_run_at <= NOW())
       RETURNING *`,
      [id]
    )
    return r.rows[0] ? mapScheduleRow(r.rows[0]) : null
  }

  async function recordScheduleRun(id: number, runId: string | null, status: string): Promise<void> {
    await q(
      `UPDATE amazon_refresh_schedules
       SET last_run_id = $2, last_run_at = NOW(), last_status = $3, updated_at = NOW()
       WHERE id = $1`,
      [id, runId, status]
    )
  }

  return {
    getRun,
    findActiveRun,
    claimRun,
    insertSkippedRun,
    markRunning,
    updateProgress,
    heartbeat,
    finishRun,
    markStaleRunsInterrupted,
    listChildRuns,
    listRecentRuns,
    summarizeJobRuns,
    listSchedules,
    claimDueSchedule,
    recordScheduleRun,
  }
}

type MemoryRow = RefreshRun & { _queuedMs: number; _heartbeatMs: number | null; _startedMs: number | null }

/** In-memory twin of the Postgres store (tests). `now` lets tests move the clock. */
function createMemoryRefreshStore({ now = () => new Date() }: { now?: () => Date } = {}) {
  const runs = new Map<string, MemoryRow>()
  const schedules = new Map<number, Schedule>()
  let order = 0

  const clone = (row: MemoryRow | undefined | null): RefreshRun | null => {
    if (!row) return null
    const { _queuedMs, _heartbeatMs, _startedMs, ...rest } = row
    return { ...rest, metadata: { ...rest.metadata } }
  }
  const nowMs = () => now().getTime()
  const nowIso = () => now().toISOString()

  function activeFor(marketplaceKey: string, jobType: string): MemoryRow | null {
    for (const row of runs.values()) {
      if (row.marketplaceKey === marketplaceKey && row.jobType === jobType && ACTIVE_STATUSES.includes(row.status)) {
        return row
      }
    }
    return null
  }

  function baseRow(run: NewRun, status: RunStatus): MemoryRow {
    order += 1
    return {
      id: run.id,
      marketplaceKey: run.marketplaceKey,
      jobType: run.jobType,
      triggerSource: run.triggerSource || 'manual',
      parentRunId: run.parentRunId || null,
      status,
      currentStep: status === 'skipped' ? 'Skipped' : 'Queued',
      progressCurrent: 0,
      progressTotal: 0,
      recordsProcessed: 0,
      errorMessage: null,
      metadata: { ...(run.metadata || {}) },
      requestedBy: run.requestedBy || null,
      processTag: run.processTag || null,
      queuedAt: nowIso(),
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
      durationMs: null,
      _queuedMs: nowMs() + order / 1000,
      _heartbeatMs: null,
      _startedMs: null,
    }
  }

  function finalize(row: MemoryRow, status: RunStatus) {
    row.status = status
    row.finishedAt = nowIso()
    row.durationMs = Math.max(0, nowMs() - (row._startedMs ?? row._queuedMs))
  }

  return {
    async getRun(id: string) {
      return clone(runs.get(id))
    },
    async findActiveRun(marketplaceKey: string, jobType: string) {
      return clone(activeFor(marketplaceKey, jobType))
    },
    async claimRun(run: NewRun): Promise<ClaimResult> {
      const existing = activeFor(run.marketplaceKey, run.jobType)
      if (existing) return { claimed: false, existing: clone(existing) }
      const row = baseRow(run, 'queued')
      runs.set(row.id, row)
      return { claimed: true, run: clone(row) as RefreshRun }
    },
    async insertSkippedRun(run: NewRun, reason: string) {
      const row = baseRow(run, 'skipped')
      row.errorMessage = truncateError(reason)
      finalize(row, 'skipped')
      runs.set(row.id, row)
      return clone(row) as RefreshRun
    },
    async markRunning(id: string, processTag: string | null) {
      const row = runs.get(id)
      if (!row || row.status !== 'queued') return null
      row.status = 'running'
      row.startedAt = nowIso()
      row._startedMs = nowMs()
      row.heartbeatAt = nowIso()
      row._heartbeatMs = nowMs()
      row.processTag = processTag ?? row.processTag
      row.currentStep = 'Starting'
      return clone(row)
    },
    async updateProgress(id: string, patch: ProgressPatch) {
      const row = runs.get(id)
      if (!row || row.status !== 'running') return
      if (patch.currentStep != null) row.currentStep = patch.currentStep
      if (patch.progressCurrent != null) row.progressCurrent = patch.progressCurrent
      if (patch.progressTotal != null) row.progressTotal = patch.progressTotal
      if (patch.recordsProcessed != null) row.recordsProcessed = patch.recordsProcessed
      if (patch.metadata) row.metadata = { ...row.metadata, ...patch.metadata }
      row.heartbeatAt = nowIso()
      row._heartbeatMs = nowMs()
    },
    async heartbeat(id: string) {
      for (const row of runs.values()) {
        if ((row.id === id && row.status === 'running') || (row.parentRunId === id && row.status === 'queued')) {
          row.heartbeatAt = nowIso()
          row._heartbeatMs = nowMs()
        }
      }
    },
    async finishRun(id: string, patch: FinishPatch) {
      const row = runs.get(id)
      if (!row || !ACTIVE_STATUSES.includes(row.status)) return null
      row.errorMessage = truncateError(patch.errorMessage)
      if (patch.recordsProcessed != null) row.recordsProcessed = patch.recordsProcessed
      if (patch.metadata) row.metadata = { ...row.metadata, ...patch.metadata }
      if (patch.currentStep != null) row.currentStep = patch.currentStep
      row.heartbeatAt = nowIso()
      finalize(row, patch.status)
      return clone(row)
    },
    async markStaleRunsInterrupted({ staleMs }: { staleMs: number }) {
      let count = 0
      const cutoff = nowMs() - staleMs
      for (const row of runs.values()) {
        if (!ACTIVE_STATUSES.includes(row.status)) continue
        const last = row._heartbeatMs ?? row._startedMs ?? row._queuedMs
        if (last < cutoff) {
          row.errorMessage = row.errorMessage || 'Interrupted: no heartbeat (server restarted or job crashed)'
          finalize(row, 'interrupted')
          count += 1
        }
      }
      return count
    },
    async listChildRuns(parentRunId: string) {
      return [...runs.values()]
        .filter((r) => r.parentRunId === parentRunId)
        .sort((a, b) => a._queuedMs - b._queuedMs)
        .map((r) => clone(r) as RefreshRun)
    },
    async listRecentRuns(marketplaceKey: string, limit = 20) {
      return [...runs.values()]
        .filter((r) => r.marketplaceKey === marketplaceKey && !r.parentRunId)
        .sort((a, b) => b._queuedMs - a._queuedMs)
        .slice(0, limit)
        .map((r) => clone(r) as RefreshRun)
    },
    async summarizeJobRuns(marketplaceKey: string, jobTypes: string[]) {
      return jobTypes.map((jobType) => {
        const mine = [...runs.values()].filter((r) => r.marketplaceKey === marketplaceKey && r.jobType === jobType)
        const latest = (statuses: string[]) =>
          mine
            .filter((r) => statuses.includes(r.status) && r.finishedAt)
            .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))[0] || null
        const ok = latest(['succeeded'])
        const bad = latest(['failed', 'interrupted'])
        return {
          jobType,
          lastSuccessAt: ok ? ok.finishedAt : null,
          lastFailureAt: bad ? bad.finishedAt : null,
          lastError: bad ? bad.errorMessage : null,
          activeRun: clone(activeFor(marketplaceKey, jobType)),
        }
      })
    },
    async listSchedules(marketplaceKey?: string) {
      return [...schedules.values()].filter((s) => !marketplaceKey || s.marketplaceKey === marketplaceKey).map((s) => ({ ...s }))
    },
    async claimDueSchedule(id: number) {
      const s = schedules.get(id)
      if (!s || !s.enabled) return null
      if (s.nextRunAt && new Date(s.nextRunAt).getTime() > nowMs()) return null
      s.nextRunAt = new Date(nowMs() + s.intervalMinutes * 60_000).toISOString()
      return { ...s }
    },
    async recordScheduleRun(id: number, runId: string | null, status: string) {
      const s = schedules.get(id)
      if (!s) return
      s.lastRunId = runId
      s.lastRunAt = nowIso()
      s.lastStatus = status
    },
    /** Test helper. */
    _putSchedule(schedule: Schedule) {
      schedules.set(schedule.id, { ...schedule })
    },
    /** Test helper: age a run's heartbeat. */
    _setHeartbeat(id: string, at: Date | null) {
      const row = runs.get(id)
      if (!row) return
      row._heartbeatMs = at ? at.getTime() : null
      row.heartbeatAt = at ? at.toISOString() : null
      if (!at) {
        row._startedMs = null
        row._queuedMs = 0
      }
    },
  }
}

module.exports = {
  RUN_STATUS,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  createPgRefreshStore,
  createMemoryRefreshStore,
  _internals: { mapRunRow, truncateError },
}
