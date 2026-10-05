import type { FreshnessStatus, MappingStatus, RefreshRun, RefreshStep, RunStatus } from '../../api/amazonControlTower'

export const DASH = '—'

export function fmtInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH
  return Math.round(value).toLocaleString('en-US')
}

export function fmtMoney(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return DASH
  return `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return DASH
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleString()
}

export function fmtAge(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return DASH
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return DASH
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

const FRESHNESS_BADGE: Record<FreshnessStatus, string> = {
  FRESH: 'ainv-badge--ok',
  WARNING: 'ainv-badge--warn',
  STALE: 'ainv-badge--danger',
  ERROR: 'ainv-badge--danger',
  NEVER_SYNCED: 'ainv-badge--neutral',
}

export function FreshnessBadge({ status }: { status: FreshnessStatus }) {
  return <span className={`ainv-badge ${FRESHNESS_BADGE[status] || 'ainv-badge--neutral'}`}>{status.replace('_', ' ')}</span>
}

const MAPPING_BADGE: Record<MappingStatus, string> = {
  CONFIRMED: 'ainv-badge--ok',
  AUTO_MATCHED: 'ainv-badge--neutral',
  REVIEW_REQUIRED: 'ainv-badge--warn',
  UNMAPPED: 'ainv-badge--danger',
}

export function MappingBadge({ status }: { status: MappingStatus }) {
  return <span className={`ainv-badge ${MAPPING_BADGE[status] || 'ainv-badge--neutral'}`}>{status.replace('_', ' ')}</span>
}

const RUN_BADGE: Record<RunStatus, string> = {
  queued: 'ainv-badge--neutral',
  running: 'ainv-badge--warn',
  succeeded: 'ainv-badge--ok',
  failed: 'ainv-badge--danger',
  skipped: 'ainv-badge--neutral',
  interrupted: 'ainv-badge--danger',
}

export function RunBadge({ status }: { status: RunStatus }) {
  return <span className={`ainv-badge ${RUN_BADGE[status] || 'ainv-badge--neutral'}`}>{status}</span>
}

function stepsOf(run: RefreshRun): RefreshStep[] {
  const steps = Array.isArray(run.metadata?.steps) ? run.metadata.steps : []
  if (steps.length) return steps
  return [{
    key: run.jobType,
    label: run.currentStep || run.jobType,
    runId: run.id,
    status: run.status,
    error: run.errorMessage,
    recordsProcessed: run.recordsProcessed,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  }]
}

/** Step-by-step progress of a refresh run (parent steps come from run.metadata.steps). */
export function RunProgress({ run }: { run: RefreshRun }) {
  const steps = stepsOf(run)
  const children = new Map((run.children || []).map((c) => [c.id, c]))
  const done = steps.filter((s) => !['queued', 'running'].includes(s.status)).length
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0
  return (
    <div className="ainv-panel" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {run.jobType === 'refresh_all' ? 'Refresh All' : run.jobType} <RunBadge status={run.status} />
        </p>
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
          Started {fmtDateTime(run.startedAt || run.queuedAt)}
          {run.durationMs != null ? ` · took ${fmtDuration(run.durationMs)}` : ''}
        </p>
      </div>
      <div className="ainv-sync-progress mt-3">
        <div className="ainv-sync-progress__track">
          <div className="ainv-sync-progress__fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ol className="mt-3 grid gap-1 text-sm">
        {steps.map((step, i) => {
          const child = step.runId ? children.get(step.runId) : undefined
          const status = (child?.status || step.status) as RunStatus
          const detail = child?.status === 'running' && child.currentStep ? child.currentStep : ''
          const error = child?.errorMessage || step.error
          const records = child?.recordsProcessed ?? step.recordsProcessed
          return (
            <li key={`${step.key}-${i}`} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-right font-mono text-xs opacity-60">{i + 1}.</span>
              <span className="min-w-[12rem]">{step.label}</span>
              <RunBadge status={status} />
              {records ? <span className="text-xs opacity-70">{fmtInt(records)} records</span> : null}
              {detail ? <span className="text-xs opacity-70">{detail}</span> : null}
              {error && status !== 'succeeded' ? (
                <span className="text-xs" style={{ color: 'var(--danger, #e11d48)' }}>{error}</span>
              ) : null}
            </li>
          )
        })}
      </ol>
      {run.status === 'failed' && run.errorMessage ? (
        <div className="ainv-banner ainv-banner--rose mt-3">{run.errorMessage}</div>
      ) : null}
    </div>
  )
}
