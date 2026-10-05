'use strict'

/**
 * Optional in-process scheduler for Control Tower refreshes. OFF unless
 * AMAZON_CONTROL_TOWER_SCHEDULER_ENABLED is truthy AND the marketplace's
 * `amazon_marketplace_settings.scheduler_enabled` is true AND the schedule row is enabled.
 *
 * Multi-instance safety (same pattern as notificationsService): each tick runs under a Postgres
 * advisory lock so only one instance evaluates schedules, a due schedule is advanced with a
 * conditional UPDATE so it fires once, and the run itself is still guarded by the single-active-run
 * index.
 */

const CONTROL_TOWER_LOCK_NAMESPACE = 0x41435454 // "ACTT"
const SCHEDULER_LOCK_ID = 1
const DEFAULT_TICK_MS = 60_000

type Env = Record<string, string | undefined>

function isSchedulerEnabled(env: Env = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.AMAZON_CONTROL_TOWER_SCHEDULER_ENABLED ?? '0').trim())
}

type PoolLike = { connect: () => Promise<{ query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }>; release: () => void }> }

/** Runs `fn` only if this process wins the advisory lock; otherwise returns null. */
function createAdvisoryLock(pool: PoolLike, lockId = SCHEDULER_LOCK_ID) {
  return async function withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    const client = await pool.connect()
    try {
      const got = await client.query('SELECT pg_try_advisory_lock($1, $2) AS locked', [CONTROL_TOWER_LOCK_NAMESPACE, lockId])
      if (!got.rows[0]?.locked) return null
      try {
        return await fn()
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [CONTROL_TOWER_LOCK_NAMESPACE, lockId])
      }
    } finally {
      client.release()
    }
  }
}

type SchedulerOptions = {
  env?: Env
  runner: { start: (p: any) => Promise<{ runIds: string[]; alreadyRunning: boolean }> }
  store: {
    listSchedules: () => Promise<any[]>
    claimDueSchedule: (id: number) => Promise<any | null>
    recordScheduleRun: (id: number, runId: string | null, status: string) => Promise<void>
  }
  withLock: <T>(fn: () => Promise<T>) => Promise<T | null>
  getSettings: (marketplaceKey: string) => Promise<{ schedulerEnabled: boolean } | null>
  tickMs?: number
  log?: { info: (...a: any[]) => void; error: (...a: any[]) => void }
}

type TickResult = { ran: boolean; reason?: string; started: string[] }

function startControlTowerScheduler(options: SchedulerOptions) {
  const log = options.log || { info: (...a: any[]) => console.info(...a), error: (...a: any[]) => console.error(...a) }
  if (!isSchedulerEnabled(options.env || process.env)) {
    log.info('[control-tower] scheduler disabled (AMAZON_CONTROL_TOWER_SCHEDULER_ENABLED is not set to 1)')
    return {
      enabled: false,
      stop() {},
      async tick(): Promise<TickResult> {
        return { ran: false, reason: 'disabled', started: [] }
      },
    }
  }

  let ticking = false
  async function tick(): Promise<TickResult> {
    if (ticking) return { ran: false, reason: 'tick-in-progress', started: [] }
    ticking = true
    try {
      const result = await options.withLock(async () => {
        const started: string[] = []
        for (const schedule of await options.store.listSchedules()) {
          if (!schedule.enabled) continue
          const settings = await options.getSettings(schedule.marketplaceKey)
          if (!settings || !settings.schedulerEnabled) continue
          const claimed = await options.store.claimDueSchedule(schedule.id)
          if (!claimed) continue
          try {
            const res = await options.runner.start({
              marketplaceKey: schedule.marketplaceKey,
              jobType: schedule.jobType,
              trigger: 'scheduler',
              requestedBy: 'scheduler',
            })
            await options.store.recordScheduleRun(schedule.id, res.runIds[0] || null, res.alreadyRunning ? 'skipped_already_running' : 'queued')
            if (!res.alreadyRunning) started.push(`${schedule.marketplaceKey}/${schedule.jobType}`)
          } catch (err: any) {
            await options.store.recordScheduleRun(schedule.id, null, `error: ${err?.message || err}`).catch(() => {})
            log.error('[control-tower] scheduled start failed', schedule.marketplaceKey, schedule.jobType, err?.message || err)
          }
        }
        return started
      })
      if (result == null) return { ran: false, reason: 'locked-elsewhere', started: [] }
      return { ran: true, started: result }
    } catch (err: any) {
      log.error('[control-tower] scheduler tick failed', err?.message || err)
      return { ran: false, reason: 'error', started: [] }
    } finally {
      ticking = false
    }
  }

  const timer = setInterval(() => {
    tick().catch(() => {})
  }, options.tickMs ?? DEFAULT_TICK_MS)
  if (typeof timer.unref === 'function') timer.unref()
  log.info('[control-tower] scheduler enabled')

  return {
    enabled: true,
    stop() {
      clearInterval(timer)
    },
    tick,
  }
}

module.exports = {
  CONTROL_TOWER_LOCK_NAMESPACE,
  isSchedulerEnabled,
  createAdvisoryLock,
  startControlTowerScheduler,
}
