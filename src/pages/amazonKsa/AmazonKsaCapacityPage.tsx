import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  createKsaCapacityPeriod,
  getKsaCapacity,
  reviseKsaCapacityPeriod,
  verifyKsaCapacityPeriod,
  type CalculatedFigure,
  type CapacityHistoryRow,
  type CapacityKpi,
  type CapacityPeriod,
  type CapacityPeriodInput,
  type CapacityResponse,
  type CapacityUnit,
  type OfficialFigure,
  type StorageType,
  type UsageSnapshot,
  type UsageTally,
} from '../../api/amazonControlTower'
import { useRefreshRun } from './useRefreshRun'
import {
  DASH,
  Empty,
  Kpi,
  RunProgress,
  SectionHeader,
  SourceMeta,
  errorText,
  fmtDate,
  fmtDateTime,
  fmtInt,
  fmtNum,
  fmtPct,
  fmtVolume,
  humanize,
  CM3_PER_CUBIC_METER,
} from './controlTowerUi'
import '../../styles/amazonInventoryPage.css'

const STORAGE_TYPES: StorageType[] = ['ALL', 'STANDARD', 'OVERSIZE', 'APPAREL', 'FOOTWEAR', 'OTHER']
const CAPACITY_UNITS: { value: CapacityUnit; label: string }[] = [
  { value: 'CUBIC_FEET', label: 'Cubic feet (ft³)' },
  { value: 'CUBIC_METERS', label: 'Cubic meters (m³)' },
  { value: 'UNITS', label: 'Units' },
  { value: 'OTHER', label: 'Other' },
]
const UNIT_SUFFIX: Record<CapacityUnit, string> = { CUBIC_FEET: 'ft³', CUBIC_METERS: 'm³', UNITS: 'units', OTHER: '' }
const LISTING_CLASS_LABEL: Record<string, string> = {
  ACTIVE: 'Active listings (sellable units)',
  INACTIVE: 'Inactive / suppressed / incomplete / closed (sellable units)',
  UNFULFILLABLE: 'Unfulfillable (all listings)',
  OTHER_UNKNOWN: 'Other / listing status unknown',
}
const BUCKET_LABEL: Record<string, string> = {
  fulfillable: 'Fulfillable',
  reserved: 'Reserved',
  researching: 'Researching',
  unfulfillable: 'Unfulfillable',
  inboundWorking: 'Inbound — working',
  inboundShipped: 'Inbound — shipped',
  inboundReceiving: 'Inbound — receiving',
}

function unitText(unit: CapacityUnit | null, label?: string | null): string {
  if (!unit) return ''
  return unit === 'OTHER' ? label || '' : UNIT_SUFFIX[unit]
}

function amount(value: number | null | undefined, unit: CapacityUnit | null, label?: string | null): string {
  if (value == null) return DASH
  const digits = unit === 'UNITS' ? 0 : 2
  return `${fmtNum(value, digits)} ${unitText(unit, label)}`.trim()
}

function changeText(value: unknown): string {
  if (value && typeof value === 'object' && 'to' in value) {
    const { from, to } = value as { from?: unknown; to?: unknown }
    return `${String(from ?? DASH)} → ${String(to ?? DASH)}`
  }
  return String(value ?? DASH)
}

function utilizationTone(pct: number | null | undefined, t: CapacityResponse['thresholds']): 'warn' | 'danger' | undefined {
  if (pct == null) return undefined
  if (pct >= t.highPct) return 'danger'
  if (pct >= t.warnPct) return 'warn'
  return undefined
}

function calcText(fig: CalculatedFigure | undefined, render: (v: number) => string): string {
  if (!fig) return DASH
  if (fig.status === 'NO_USAGE_FOR_STORAGE_TYPE') return 'No stock of this storage type'
  if (fig.status === 'UNIT_NOT_COMPARABLE') return 'Not comparable (unit OTHER)'
  return fig.value == null ? DASH : `${fig.isLowerBound ? '≥ ' : ''}${render(fig.value)}`
}

/** Official and calculated values side by side; the estimate is never shown as the official figure. */
function DualFigure({ label, official, calculated, render, tone }: {
  label: string
  official: OfficialFigure | null | undefined
  calculated: CalculatedFigure | undefined
  render: (v: number) => string
  tone?: 'warn' | 'danger'
}) {
  return (
    <Kpi
      label={label}
      tone={tone}
      value={official?.value != null ? render(official.value) : 'Not entered'}
      hint={
        <>
          <span className="block">Official (Seller Central): {official?.value != null ? render(official.value) : 'not entered'}</span>
          <span className="block">Calculated estimate: {calcText(calculated, render)}</span>
          {calculated?.coveragePct != null ? <span className="block">Volume coverage {fmtPct(calculated.coveragePct)}</span> : null}
        </>
      }
      meta={
        <div className="grid gap-1">
          {official ? <SourceMeta source={official.source} asOf={official.asOf} confidence={official.confidence} /> : null}
          {calculated ? <SourceMeta source={calculated.source} asOf={calculated.asOf} confidence={calculated.confidence} /> : null}
        </div>
      }
    />
  )
}

function KpiGroup({ kpi, thresholds }: { kpi: CapacityKpi; thresholds: CapacityResponse['thresholds'] }) {
  const unit = kpi.unit
  const label = kpi.period?.capacityUnitLabel
  const render = (v: number) => amount(v, unit, label)
  const pct = (v: number) => fmtPct(v)
  const utilization = kpi.utilizationPct?.official?.value ?? kpi.utilizationPct?.calculated?.value ?? null
  const storage = kpi.storageType === 'OTHER' && kpi.period?.storageTypeLabel ? kpi.period.storageTypeLabel : humanize(kpi.storageType)
  return (
    <section className="ainv-panel">
      <h2 className="ainv-section-title">
        Storage type: {storage}
        {kpi.period ? (
          <span className="ml-2 text-sm font-normal opacity-70">
            Period {kpi.period.periodStart} → {kpi.period.periodEnd}
            {kpi.period.verifiedAt ? ' · verified' : ' · not verified'}
          </span>
        ) : null}
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Official Capacity"
          value={kpi.officialCapacity.value != null ? render(kpi.officialCapacity.value) : 'LIMIT MISSING'}
          tone={kpi.officialCapacity.value == null ? 'warn' : undefined}
          hint={kpi.officialCapacity.value == null ? 'Enter the limit from Seller Central → Inventory → Capacity monitor.' : undefined}
          meta={<SourceMeta source={kpi.officialCapacity.source} asOf={kpi.officialCapacity.asOf} confidence={kpi.officialCapacity.confidence} />}
        />
        <DualFigure label="Used" official={kpi.used?.official} calculated={kpi.used?.calculated} render={render} />
        <Kpi
          label="Inbound / Committed"
          value={calcText(kpi.inboundCommitted?.calculated, render)}
          hint="Calculated inbound (working + shipped + receiving). Committed capacity is not exposed by Amazon."
          meta={kpi.inboundCommitted ? <SourceMeta source="CALCULATED" asOf={kpi.inboundCommitted.calculated.asOf} confidence={kpi.inboundCommitted.calculated.confidence} /> : null}
        />
        <DualFigure label="Available" official={kpi.available?.official} calculated={kpi.available?.calculated} render={render} />
        <DualFigure
          label="Utilization %"
          official={kpi.utilizationPct?.official}
          calculated={kpi.utilizationPct?.calculated}
          render={pct}
          tone={utilizationTone(utilization, thresholds)}
        />
        <Kpi label="Required by Healthy Replenishment" value="NOT CALCULATED YET" hint={kpi.requiredByHealthyReplenishment.reason} />
        <Kpi label="Capacity Shortfall" value="NOT CALCULATED YET" hint={kpi.shortfall.reason} />
      </div>
    </section>
  )
}

function TallyRow({ label, t }: { label: string; t: UsageTally }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="text-right">{fmtInt(t.units)}</td>
      <td className="text-right">{fmtInt(t.unitsWithVolume)}</td>
      <td className="text-right">{t.unitsWithVolume > 0 ? `${t.isLowerBound ? '≥ ' : ''}${fmtVolume(t.volumeCm3)}` : t.units > 0 ? 'VOLUME DATA MISSING' : DASH}</td>
      <td className="text-right">{fmtPct(t.coveragePct)}</td>
    </tr>
  )
}

function TallyTable({ rows }: { rows: { key: string; label: string; t: UsageTally }[] }) {
  return (
    <div className="ainv-table-wrap overflow-x-auto">
      <table className="ainv-table w-full min-w-[48rem] text-left text-sm">
        <thead>
          <tr>
            <th>Bucket</th>
            <th className="text-right">Units</th>
            <th className="text-right">Units with volume</th>
            <th className="text-right">Calculated volume</th>
            <th className="text-right">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <TallyRow key={r.key} label={r.label} t={r.t} />)}
        </tbody>
      </table>
    </div>
  )
}

/** Calculated usage over time (m³). Not Amazon's official figure. */
function UsageChart({ snapshots }: { snapshots: UsageSnapshot[] }) {
  const points = [...snapshots].reverse().slice(-60)
  if (points.length < 2) {
    return <Empty text="INSUFFICIENT HISTORY — fewer than two calculated usage snapshots. History builds up with each capacity/health refresh (no backfill)." />
  }
  const values = points.map((p) => (p.onHandVolumeCm3 + p.inboundWorkingVolumeCm3 + p.inboundShippedVolumeCm3 + p.inboundReceivingVolumeCm3) / CM3_PER_CUBIC_METER)
  const onHand = points.map((p) => p.onHandVolumeCm3 / CM3_PER_CUBIC_METER)
  const max = Math.max(...values, 0.0001)
  const w = 640
  const h = 160
  const bw = w / points.length
  return (
    <figure className="px-4 pb-4">
      <svg viewBox={`0 0 ${w} ${h + 20}`} role="img" aria-label="Calculated capacity usage history" className="w-full">
        {points.map((p, i) => {
          const total = (values[i] / max) * h
          const oh = (onHand[i] / max) * h
          return (
            <g key={p.id}>
              <title>{`${fmtDateTime(p.computedAt)}: ${fmtNum(values[i], 3)} m³ (on-hand ${fmtNum(onHand[i], 3)} m³, coverage ${fmtPct(p.coveragePct)})`}</title>
              <rect x={i * bw + 1} y={h - total} width={Math.max(bw - 2, 1)} height={total} fill="#7dd3fc" />
              <rect x={i * bw + 1} y={h - oh} width={Math.max(bw - 2, 1)} height={oh} fill="#0284c7" />
            </g>
          )
        })}
        <text x={0} y={h + 15} fontSize="10" fill="currentColor">{fmtDate(points[0].computedAt)}</text>
        <text x={w} y={h + 15} fontSize="10" textAnchor="end" fill="currentColor">{fmtDate(points[points.length - 1].computedAt)}</text>
        <text x={0} y={10} fontSize="10" fill="currentColor">{fmtNum(max, 3)} m³</text>
      </svg>
      <figcaption className="text-xs" style={{ color: 'var(--text-dim)' }}>
        Dark: calculated on-hand · light: + calculated inbound. Estimate from FBA snapshots × unit volume — not Amazon&apos;s capacity-monitor figure.
      </figcaption>
    </figure>
  )
}

type FormState = Record<keyof CapacityPeriodInput, string>

const EMPTY_FORM: FormState = {
  periodStart: '',
  periodEnd: '',
  storageType: 'ALL',
  storageTypeLabel: '',
  capacityLimit: '',
  capacityUnit: 'CUBIC_FEET',
  capacityUnitLabel: '',
  amazonReportedUsage: '',
  source: 'SELLER_CENTRAL_MANUAL',
  sourceReference: '',
  notes: '',
}

function formFromPeriod(p: CapacityPeriod): FormState {
  return {
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    storageType: p.storageType,
    storageTypeLabel: p.storageTypeLabel || '',
    capacityLimit: p.capacityLimit == null ? '' : String(p.capacityLimit),
    capacityUnit: p.capacityUnit,
    capacityUnitLabel: p.capacityUnitLabel || '',
    amazonReportedUsage: p.amazonReportedUsage == null ? '' : String(p.amazonReportedUsage),
    source: p.source === 'IMPORT' ? 'IMPORT' : 'SELLER_CENTRAL_MANUAL',
    sourceReference: p.sourceReference || '',
    notes: p.notes || '',
  }
}

function inputFromForm(f: FormState): CapacityPeriodInput {
  const text = (v: string) => (v.trim() === '' ? null : v.trim())
  return {
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    storageType: f.storageType as StorageType,
    storageTypeLabel: text(f.storageTypeLabel),
    capacityLimit: Number(f.capacityLimit),
    capacityUnit: f.capacityUnit as CapacityUnit,
    capacityUnitLabel: text(f.capacityUnitLabel),
    amazonReportedUsage: f.amazonReportedUsage.trim() === '' ? null : Number(f.amazonReportedUsage),
    source: f.source as CapacityPeriodInput['source'],
    sourceReference: text(f.sourceReference),
    notes: text(f.notes),
  }
}

function CapacityForm({ editing, onDone, onCancel }: { editing: CapacityPeriod | null; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<FormState>(editing ? formFromPeriod(editing) : EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setForm(editing ? formFromPeriod(editing) : EMPTY_FORM)
    setError('')
  }, [editing])

  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const input = inputFromForm(form)
      if (editing) {
        const before = inputFromForm(formFromPeriod(editing))
        const patch: Partial<CapacityPeriodInput> = {}
        for (const key of Object.keys(input) as (keyof CapacityPeriodInput)[]) {
          if (String(input[key] ?? '') !== String(before[key] ?? '')) (patch as Record<string, unknown>)[key] = input[key]
        }
        if (!Object.keys(patch).length) throw new Error('Nothing changed.')
        await reviseKsaCapacityPeriod(editing.id, patch)
      } else {
        await createKsaCapacityPeriod(input)
      }
      setForm(EMPTY_FORM)
      onDone()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="ainv-panel" onSubmit={(e) => void submit(e)}>
      <h2 className="ainv-section-title">{editing ? `Revise capacity period #${editing.id}` : 'Enter official capacity (Seller Central)'}</h2>
      <p className="mt-1 text-xs" style={{ color: 'var(--text-dim)' }}>
        {editing
          ? 'A revision is saved as a new version; the previous values stay in the history and the audit trail.'
          : 'Copy the limit (and, if shown, the usage) from Seller Central → Inventory → Capacity monitor. Saved only in this app.'}
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <label className="ainv-label">
          Period start
          <input className="ainv-input" type="date" required value={form.periodStart} onChange={set('periodStart')} />
        </label>
        <label className="ainv-label">
          Period end
          <input className="ainv-input" type="date" required value={form.periodEnd} onChange={set('periodEnd')} />
        </label>
        <label className="ainv-label">
          Storage type
          <select className="ainv-input" value={form.storageType} onChange={set('storageType')}>
            {STORAGE_TYPES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
        </label>
        {form.storageType === 'OTHER' ? (
          <label className="ainv-label">
            Storage type name
            <input className="ainv-input" required value={form.storageTypeLabel} onChange={set('storageTypeLabel')} />
          </label>
        ) : null}
        <label className="ainv-label">
          Capacity limit
          <input className="ainv-input" inputMode="decimal" required value={form.capacityLimit} onChange={set('capacityLimit')} />
        </label>
        <label className="ainv-label">
          Unit
          <select className="ainv-input" value={form.capacityUnit} onChange={set('capacityUnit')}>
            {CAPACITY_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </label>
        {form.capacityUnit === 'OTHER' ? (
          <label className="ainv-label">
            Unit name
            <input className="ainv-input" required value={form.capacityUnitLabel} onChange={set('capacityUnitLabel')} />
          </label>
        ) : null}
        <label className="ainv-label">
          Amazon-reported usage
          <input className="ainv-input" inputMode="decimal" placeholder="optional" value={form.amazonReportedUsage} onChange={set('amazonReportedUsage')} />
        </label>
        <label className="ainv-label">
          Source
          <select className="ainv-input" value={form.source} onChange={set('source')}>
            <option value="SELLER_CENTRAL_MANUAL">Seller Central (manual)</option>
            <option value="IMPORT">Import</option>
          </select>
        </label>
        <label className="ainv-label md:col-span-2">
          Source reference
          <input className="ainv-input" placeholder="e.g. screenshot name or Seller Central page" value={form.sourceReference} onChange={set('sourceReference')} />
        </label>
        <label className="ainv-label md:col-span-3">
          Notes
          <input className="ainv-input" value={form.notes} onChange={set('notes')} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" className="ainv-btn ainv-btn--primary-emerald" disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save revision' : 'Save capacity period'}
        </button>
        {editing ? <button type="button" className="ainv-btn" onClick={onCancel}>Cancel</button> : null}
      </div>
      {error ? <div className="ainv-banner ainv-banner--rose mt-3">{error}</div> : null}
    </form>
  )
}

function HistoryTable({ rows, onRevise, onVerify, busyId }: { rows: CapacityHistoryRow[]; onRevise: (p: CapacityPeriod) => void; onVerify: (id: number) => void; busyId: number | null }) {
  if (!rows.length) return <Empty text="No capacity periods entered yet. Official capacity is not exposed by the Amazon API, so enter it from Seller Central above." />
  return (
    <div className="ainv-table-wrap overflow-x-auto">
      <table className="ainv-table w-full min-w-[100rem] text-left text-sm">
        <thead>
          <tr>
            <th>#</th>
            <th>Period</th>
            <th>Storage</th>
            <th className="text-right">Official limit</th>
            <th className="text-right">Amazon-reported usage</th>
            <th className="text-right">Calculated usage in period (estimate)</th>
            <th className="text-right">Official utilization</th>
            <th className="text-right">Calculated utilization</th>
            <th>Source</th>
            <th>Entered</th>
            <th>Verified</th>
            <th>Version</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const current = !p.supersededAt
            return (
              <tr key={p.id} className={current ? '' : 'ainv-table__status-inactive'}>
                <td className="font-mono">{p.id}</td>
                <td>{p.periodStart} → {p.periodEnd}</td>
                <td>{p.storageType === 'OTHER' ? p.storageTypeLabel : humanize(p.storageType)}</td>
                <td className="text-right">{amount(p.capacityLimit, p.capacityUnit, p.capacityUnitLabel)}</td>
                <td className="text-right">{amount(p.amazonReportedUsage, p.capacityUnit, p.capacityUnitLabel)}</td>
                <td className="text-right" title={p.calculatedAt ? `Snapshot ${fmtDateTime(p.calculatedAt)}, coverage ${fmtPct(p.calculatedCoveragePct)}` : 'No calculated snapshot inside this period'}>
                  {p.calculatedUsageInPeriod == null ? <span className="ainv-table__muted">{p.calculatedAt ? DASH : 'INSUFFICIENT HISTORY'}</span> : amount(p.calculatedUsageInPeriod, p.capacityUnit, p.capacityUnitLabel)}
                </td>
                <td className="text-right">{fmtPct(p.officialUtilizationPct)}</td>
                <td className="text-right">{fmtPct(p.calculatedUtilizationPct)}</td>
                <td className="text-xs">
                  {humanize(p.source)}
                  {p.sourceReference ? <div className="opacity-70">{p.sourceReference}</div> : null}
                </td>
                <td className="text-xs">{fmtDateTime(p.enteredAt)}<div className="opacity-70">{p.enteredBy || DASH}</div></td>
                <td className="text-xs">{p.verifiedAt ? <>{fmtDateTime(p.verifiedAt)}<div className="opacity-70">{p.verifiedBy}</div></> : 'Not verified'}</td>
                <td className="text-xs">
                  {current ? 'Current' : `Superseded by #${p.supersededById}`}
                  {p.supersedesId ? <div className="opacity-70">revises #{p.supersedesId}</div> : null}
                </td>
                <td>
                  {current ? (
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className="ainv-btn" onClick={() => onRevise(p)}>Revise</button>
                      {!p.verifiedAt ? (
                        <button type="button" className="ainv-btn" disabled={busyId === p.id} onClick={() => onVerify(p.id)}>Mark verified</button>
                      ) : null}
                    </div>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function AmazonKsaCapacityPage() {
  const [data, setData] = useState<CapacityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<CapacityPeriod | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await getKsaCapacity())
      setError('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useRefreshRun({ watchJobTypes: ['refresh_health', 'refresh_all'], onFinished: () => void load() })

  const verify = async (id: number) => {
    if (!window.confirm('Mark this capacity period as verified against Seller Central?')) return
    setBusyId(id)
    try {
      await verifyKsaCapacityPeriod(id)
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusyId(null)
    }
  }

  const usage = data?.usage
  const lowCoverage = usage?.coveragePct != null && data ? usage.coveragePct < data.thresholds.coverageMinPct : false
  const storageRows = useMemo(
    () =>
      usage
        ? Object.entries(usage.byStorageType).flatMap(([k, v]) => [
            { key: `${k}-onhand`, label: `${humanize(k)} — on-hand`, t: v.onHand },
            { key: `${k}-inbound`, label: `${humanize(k)} — inbound`, t: v.inbound },
          ])
        : [],
    [usage],
  )

  return (
    <div className="ainv-page mx-auto flex max-w-[120rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="ainv-page__header flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="ainv-page__eyebrow ainv-page__eyebrow--amber">Amazon KSA · Control Tower</p>
          <h1 className="ainv-page__title">Capacity</h1>
          <p className="ainv-page__lead">
            Official FBA capacity (entered from Seller Central) next to this app&apos;s calculated estimate. Calculated figures are always
            labelled ESTIMATE and never replace the official numbers. Nothing here changes Amazon.{' '}
            <Link className="ainv-link-emerald" to="/amazon-ksa/inventory-health">Inventory Health →</Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ainv-btn" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </button>
          <button type="button" className="ainv-btn ainv-btn--primary-sky" onClick={() => void refresh.start('refresh_health')} disabled={refresh.busy}>
            {refresh.busy ? 'Refreshing…' : 'Refresh Capacity & Health'}
          </button>
        </div>
      </header>

      {refresh.error ? <div className="ainv-banner ainv-banner--rose">{refresh.error}</div> : null}
      {refresh.run ? <RunProgress run={refresh.run} /> : null}
      {error ? <div className="ainv-banner ainv-banner--rose">{error}</div> : null}

      {data && usage ? (
        <>
          <div className="ainv-banner ainv-banner--amber" role="note">
            Official capacity API: {humanize(data.officialCapacityApi.status)}. {data.officialCapacityApi.note}
          </div>

          {data.kpis.map((kpi) => (
            <KpiGroup key={`${kpi.storageType}-${kpi.periodId ?? 'none'}`} kpi={kpi} thresholds={data.thresholds} />
          ))}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Calculated on-hand (physical, all listings)"
              value={usage.onHand.unitsWithVolume > 0 ? `${usage.onHand.isLowerBound ? '≥ ' : ''}${fmtVolume(usage.onHand.volumeCm3)}` : 'VOLUME DATA MISSING'}
              hint={`${fmtInt(usage.onHand.units)} units · volume coverage ${fmtPct(usage.onHand.coveragePct)}`}
              meta={<SourceMeta source="CALCULATED" asOf={usage.asOf} confidence="ESTIMATE" />}
            />
            <Kpi
              label="Calculated inbound"
              value={usage.inbound.unitsWithVolume > 0 ? `${usage.inbound.isLowerBound ? '≥ ' : ''}${fmtVolume(usage.inbound.volumeCm3)}` : usage.inbound.units ? 'VOLUME DATA MISSING' : DASH}
              hint={`${fmtInt(usage.inbound.units)} units · coverage ${fmtPct(usage.inbound.coveragePct)}`}
              meta={<SourceMeta source="CALCULATED" asOf={usage.asOf} confidence="ESTIMATE" />}
            />
            <Kpi
              label="Amazon planning storage volume"
              value={data.amazonPlanningStorageVolume ? fmtVolume(data.amazonPlanningStorageVolume.volumeCm3) : DASH}
              hint={data.amazonPlanningStorageVolume ? data.amazonPlanningStorageVolume.note : 'No inventory planning report loaded yet.'}
              meta={data.amazonPlanningStorageVolume ? <SourceMeta source="AMAZON_REPORT" asOf={data.amazonPlanningStorageVolume.asOf} confidence={data.amazonPlanningStorageVolume.confidence} /> : null}
            />
            <Kpi
              label="Volume data coverage"
              value={fmtPct(usage.coveragePct)}
              tone={lowCoverage ? 'warn' : undefined}
              hint={`${fmtInt(usage.missingVolume.length)} SKUs with stock have VOLUME DATA MISSING (counted as missing, not zero). Minimum ${data.thresholds.coverageMinPct}%.`}
            />
          </section>

          {lowCoverage ? (
            <div className="ainv-banner ainv-banner--amber" role="note">
              Volume coverage is {fmtPct(usage.coveragePct)} (below {data.thresholds.coverageMinPct}%). Calculated totals are lower bounds.
            </div>
          ) : null}

          <section className="ainv-panel overflow-hidden p-0">
            <SectionHeader title="Physical capacity by listing class (calculated)" note="Every unit physically at Amazon counts toward capacity, whatever the listing status." />
            <TallyTable rows={(['ACTIVE', 'INACTIVE', 'UNFULFILLABLE', 'OTHER_UNKNOWN'] as const).map((k) => ({ key: k, label: LISTING_CLASS_LABEL[k], t: usage.byListingClass[k] }))} />
          </section>

          <section className="ainv-panel overflow-hidden p-0">
            <SectionHeader title="Usage by inventory bucket (calculated)" note="Buckets do not overlap; inbound is kept separate from on-hand." />
            <TallyTable rows={Object.entries(usage.buckets).map(([k, t]) => ({ key: k, label: BUCKET_LABEL[k] || k, t }))} />
          </section>

          <section className="ainv-panel overflow-hidden p-0">
            <SectionHeader title="Usage by storage type (calculated)" note="Storage type comes from Amazon's inventory planning report; SKUs not in that report are UNKNOWN." />
            {storageRows.length ? <TallyTable rows={storageRows} /> : <Empty text="No FBA inventory snapshot yet." />}
          </section>

          <section className="ainv-panel overflow-hidden p-0">
            <SectionHeader title="VOLUME DATA MISSING" total={usage.missingVolume.length} shown={Math.min(usage.missingVolume.length, 100)} note="SKUs with FBA units but no Amazon package / storage volume. Not counted as zero." />
            {usage.missingVolume.length ? (
              <div className="ainv-table-wrap overflow-x-auto">
                <table className="ainv-table w-full min-w-[48rem] text-left text-sm">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Product</th>
                      <th>Listing class</th>
                      <th className="text-right">On-hand units</th>
                      <th className="text-right">Inbound units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.missingVolume.slice(0, 100).map((m) => (
                      <tr key={m.sellerSku}>
                        <td className="ainv-table__sku font-mono">{m.sellerSku}</td>
                        <td className="max-w-md truncate" title={m.title || ''}>{m.title || DASH}</td>
                        <td>{humanize(m.listingClass)}</td>
                        <td className="text-right">{fmtInt(m.onHandUnits)}</td>
                        <td className="text-right">{fmtInt(m.inboundUnits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="Every SKU with FBA stock has a unit volume." />
            )}
            <div className="px-4 pb-4 pt-2 text-xs" style={{ color: 'var(--text-dim)' }}>
              Unit volume source order: {data.volumeSourcePriority.map((s, i) => `${i + 1}. ${s.label}`).join(' · ')}. Used now:{' '}
              {Object.entries(usage.volumeSources).map(([k, n]) => `${humanize(k)} ${fmtInt(n)}`).join(', ') || DASH}.
            </div>
          </section>

          <CapacityForm editing={editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); void load() }} />

          <section className="ainv-panel overflow-hidden p-0">
            <SectionHeader title="Capacity history" total={data.history.length} shown={data.history.length} note="Official entries per period, with the calculated estimate from the snapshot taken inside that period." />
            <HistoryTable rows={data.history} onRevise={(p) => { setEditing(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }} onVerify={(id) => void verify(id)} busyId={busyId} />
          </section>

          <section className="ainv-panel overflow-hidden p-0">
            <SectionHeader title="Calculated usage history" total={data.usageHistory.length} shown={Math.min(60, data.usageHistory.length)} />
            <UsageChart snapshots={data.usageHistory} />
          </section>

          <section className="ainv-panel overflow-hidden p-0">
            <SectionHeader title="Audit trail" total={data.events.length} shown={data.events.length} note="Every create / revise / verify. History is never overwritten." />
            {data.events.length ? (
              <div className="ainv-table-wrap overflow-x-auto">
                <table className="ainv-table w-full min-w-[60rem] text-left text-sm">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Action</th>
                      <th>Period</th>
                      <th>By</th>
                      <th>Changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((ev) => (
                      <tr key={ev.id}>
                        <td>{fmtDateTime(ev.createdAt)}</td>
                        <td>{ev.action}</td>
                        <td className="font-mono">#{ev.periodId}{ev.previousPeriodId ? ` (from #${ev.previousPeriodId})` : ''}</td>
                        <td>{ev.actor || DASH}</td>
                        <td className="font-mono text-xs">
                          {Object.entries(ev.changes).map(([k, v]) => <div key={k}>{k}: {changeText(v)}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="No capacity changes recorded yet." />
            )}
          </section>

          <section className="ainv-panel">
            <h2 className="ainv-section-title">Capacity formula</h2>
            <pre className="mt-2 whitespace-pre-wrap text-xs" style={{ color: 'var(--text-muted)' }}>{data.formula}</pre>
          </section>
        </>
      ) : loading ? (
        <Empty text="Loading capacity…" />
      ) : null}
    </div>
  )
}
