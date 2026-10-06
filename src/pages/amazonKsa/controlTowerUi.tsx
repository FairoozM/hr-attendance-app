import type { ReactNode } from 'react'
import type {
  AmazonListingStatus,
  Confidence,
  FreshnessStatus,
  HealthStatus,
  MappingIndicator,
  MappingStatus,
  RefreshRun,
  RefreshStep,
  RunStatus,
} from '../../api/amazonControlTower'

export const DASH = '—'
export const CM3_PER_CUBIC_METER = 1_000_000
export const CM3_PER_CUBIC_FOOT = 28_316.846592

export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return DASH
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return DASH
  return `${value.toFixed(digits)}%`
}

/** cm³ shown as m³ and ft³ (the units Seller Central uses for capacity). */
export function fmtVolume(cm3: number | null | undefined): string {
  if (cm3 == null || !Number.isFinite(cm3)) return DASH
  return `${fmtNum(cm3 / CM3_PER_CUBIC_METER, 3)} m³ · ${fmtNum(cm3 / CM3_PER_CUBIC_FOOT, 1)} ft³`
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return DASH
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleDateString()
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const humanize = (value: string | null | undefined): string => (value ? value.replace(/_/g, ' ') : DASH)

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

const LISTING_BADGE: Record<AmazonListingStatus, string> = {
  ACTIVE: 'ainv-badge--ok',
  INACTIVE: 'ainv-badge--danger',
  SUPPRESSED: 'ainv-badge--danger',
  INCOMPLETE: 'ainv-badge--warn',
  CLOSED: 'ainv-badge--neutral',
  UNKNOWN: 'ainv-badge--neutral',
}

export function ListingStatusBadge({ status, title }: { status: AmazonListingStatus | null; title?: string | null }) {
  if (!status) return <span className="ainv-badge ainv-badge--neutral" title="Listing status not refreshed yet">NOT REFRESHED</span>
  return <span className={`ainv-badge ${LISTING_BADGE[status] || 'ainv-badge--neutral'}`} title={title || undefined}>{status}</span>
}

const HEALTH_BADGE: Record<HealthStatus, string> = {
  HEALTHY: 'ainv-badge--ok',
  WATCH: 'ainv-badge--warn',
  SLOW: 'ainv-badge--warn',
  EXCESS: 'ainv-badge--warn',
  AGED: 'ainv-badge--danger',
  ZERO_SALES: 'ainv-badge--danger',
  OUT_ZERO_FBA: 'ainv-badge--danger',
  DATA_INCOMPLETE: 'ainv-badge--neutral',
}

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  HEALTHY: 'HEALTHY',
  WATCH: 'WATCH',
  SLOW: 'SLOW',
  EXCESS: 'EXCESS',
  AGED: 'AGED',
  ZERO_SALES: 'ZERO SALES',
  OUT_ZERO_FBA: 'OUT / ZERO FBA',
  DATA_INCOMPLETE: 'DATA INCOMPLETE',
}

export function HealthBadge({ status, title }: { status: HealthStatus; title?: string }) {
  return <span className={`ainv-badge ${HEALTH_BADGE[status] || 'ainv-badge--neutral'}`} title={title}>{HEALTH_LABEL[status] || status}</span>
}

const INDICATOR_BADGE: Record<MappingIndicator, string> = {
  MAPPED: 'ainv-badge--ok',
  AMBIGUOUS: 'ainv-badge--warn',
  UNMAPPED: 'ainv-badge--danger',
}

export function MappingIndicatorBadge({ indicator }: { indicator: MappingIndicator }) {
  return <span className={`ainv-badge ${INDICATOR_BADGE[indicator] || 'ainv-badge--neutral'}`}>{indicator}</span>
}

const SOURCE_LABEL: Record<string, string> = {
  SELLER_CENTRAL_MANUAL: 'Seller Central (manual entry)',
  IMPORT: 'Import',
  AMAZON_API: 'Amazon API',
  CALCULATED: 'Calculated',
  AMAZON_REPORT: 'Amazon report',
}

/** Source · as of · confidence line every capacity number carries. Estimates are always labelled. */
export function SourceMeta({ source, asOf, confidence }: { source: string | null | undefined; asOf: string | null | undefined; confidence: Confidence | string | null | undefined }) {
  const estimate = source === 'CALCULATED'
  return (
    <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
      {estimate ? <span className="ainv-badge ainv-badge--warn mr-1">ESTIMATE</span> : null}
      Source: {source ? SOURCE_LABEL[source] || humanize(source) : DASH} · As of {fmtDateTime(asOf)} · Confidence: {confidence ? humanize(String(confidence)) : DASH}
    </span>
  )
}

export function Kpi({ label, value, hint, meta, tone }: { label: string; value: string; hint?: ReactNode; meta?: ReactNode; tone?: 'warn' | 'danger' }) {
  const border = tone === 'danger' ? 'var(--danger, #e11d48)' : tone === 'warn' ? '#f59e0b' : undefined
  return (
    <div className="ainv-summary-card" style={border ? { borderColor: border } : undefined}>
      <p className="ainv-summary-card__label">{label}</p>
      <p className="ainv-summary-card__value">{value}</p>
      {hint ? <p className="ainv-summary-card__hint">{hint}</p> : null}
      {meta ? <div className="mt-1">{meta}</div> : null}
    </div>
  )
}

export function SectionHeader({ title, total, shown, note }: { title: string; total?: number; shown?: number; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
      <h2 className="ainv-section-title">
        {title} {total != null ? <span className="text-sm font-normal opacity-70">({fmtInt(total)})</span> : null}
      </h2>
      <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
        {total != null && shown != null && shown < total ? `Showing first ${shown} of ${total}. ` : ''}
        {note}
      </p>
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
      {text}
    </div>
  )
}

const JOB_LABEL: Record<string, string> = {
  refresh_all: 'Refresh All',
  refresh_health: 'Refresh Capacity & Health',
  listing_status: 'Listing status',
  inventory_reports: 'Inventory reports',
  removal_orders: 'Removal orders',
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
          {JOB_LABEL[run.jobType] || run.jobType} <RunBadge status={run.status} />
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
