import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  changeKsaSkuMapping,
  confirmKsaSku,
  getKsaSettings,
  listKsaSkuMaster,
  searchKsaZohoItems,
  unmapKsaSku,
  updateKsaSettings,
  updateKsaSkuParameters,
  type MappingStatus,
  type SettingsPatch,
  type SettingsResponse,
  type SkuMasterList,
  type SkuMasterRow,
  type ZohoItemOption,
} from '../../api/amazonControlTower'
import { useRefreshRun } from './useRefreshRun'
import { DASH, ListingStatusBadge, MappingBadge, RunProgress, fmtDateTime, fmtInt } from './controlTowerUi'
import '../../styles/amazonInventoryPage.css'

const PAGE_SIZE = 100
const STATUS_FILTERS: { value: MappingStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'REVIEW_REQUIRED', label: 'Review required' },
  { value: 'UNMAPPED', label: 'Unmapped' },
  { value: 'AUTO_MATCHED', label: 'Auto matched' },
  { value: 'CONFIRMED', label: 'Confirmed' },
]

type ThresholdKey =
  | 'healthAgedMinDays'
  | 'healthExcessCoverDays'
  | 'healthLowCoverDays'
  | 'healthSlowUnitsPer30d'
  | 'healthVeryLowUnitsPer30d'
  | 'removalStuckDays'
  | 'capacityWarnPct'
  | 'capacityHighPct'
  | 'capacityCriticalPct'
  | 'usageCoverageMinPct'

const THRESHOLD_FIELDS: { key: ThresholdKey; label: string; hint?: string }[] = [
  { key: 'healthAgedMinDays', label: 'Aged from (days)' },
  { key: 'healthExcessCoverDays', label: 'Excess cover (days)', hint: 'Days of cover above this = EXCESS' },
  { key: 'healthLowCoverDays', label: 'Low cover (days)', hint: 'Below this = WATCH' },
  { key: 'healthSlowUnitsPer30d', label: 'Slow seller (units / 30d)', hint: 'Below this = SLOW' },
  { key: 'healthVeryLowUnitsPer30d', label: 'Very low velocity (units / 30d)', hint: 'Capacity release candidate' },
  { key: 'removalStuckDays', label: 'Removal stuck after (days)' },
  { key: 'capacityWarnPct', label: 'Capacity warning (%)' },
  { key: 'capacityHighPct', label: 'Capacity high (%)' },
  { key: 'capacityCriticalPct', label: 'Capacity critical (%)' },
  { key: 'usageCoverageMinPct', label: 'Min volume coverage (%)', hint: 'Below this, usage is flagged' },
]

const METHOD_LABEL: Record<string, string> = {
  EXACT_ITEM_CODE: 'Exact item code',
  EXACT_ITEM_NAME: 'Exact item name',
  NORMALIZED_ITEM_CODE: 'Normalized item code',
  NORMALIZED_ITEM_NAME: 'Normalized item name',
  MANUAL: 'Manual',
  MANUAL_UNMAPPED: 'Marked unmapped',
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function MappingDialog({ row, onClose, onSaved }: { row: SkuMasterRow; onClose: () => void; onSaved: (row: SkuMasterRow) => void }) {
  const [search, setSearch] = useState(row.zohoItemCode || row.normalizedSku || row.sellerSku)
  const [items, setItems] = useState<ZohoItemOption[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const term = search.trim()
    if (term.length < 2) {
      setItems([])
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      setSearching(true)
      searchKsaZohoItems(term)
        .then((found) => !cancelled && setItems(found))
        .catch((err) => !cancelled && setError(errorText(err)))
        .finally(() => !cancelled && setSearching(false))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [search])

  const choose = async (zohoItemId: string, viaCandidate: boolean) => {
    setSaving(zohoItemId)
    setError('')
    try {
      onSaved(viaCandidate ? await confirmKsaSku(row.id, zohoItemId) : await changeKsaSkuMapping(row.id, zohoItemId))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving('')
    }
  }

  return (
    <div className="ainv-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Change mapping for ${row.sellerSku}`}>
      <div className="ainv-modal max-w-3xl">
        <h2 className="ainv-modal__title">Map {row.sellerSku}</h2>
        <div className="ainv-modal__body grid gap-4">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{row.amazonTitle || DASH}</p>
          {row.mappingCandidates.length ? (
            <div>
              <p className="ainv-label mb-1">Suggested matches</p>
              <ul className="grid gap-1">
                {row.mappingCandidates.map((c) => (
                  <li key={c.zohoItemId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      <span className="font-mono">{c.itemCode || c.zohoItemId}</span> · {c.itemName || DASH}
                      <span className="ml-2 text-xs opacity-70">{METHOD_LABEL[c.method] || c.method}</span>
                    </span>
                    <button type="button" className="ainv-btn" disabled={!!saving} onClick={() => void choose(c.zohoItemId, true)}>
                      {saving === c.zohoItemId ? 'Saving…' : 'Use this'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <label className="ainv-label">
            Search Life Smile warehouse items (latest snapshot)
            <input className="ainv-input" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </label>
          <div className="max-h-80 overflow-y-auto">
            {searching ? <p className="text-sm opacity-70">Searching…</p> : null}
            {!searching && search.trim().length >= 2 && !items.length ? <p className="text-sm opacity-70">No items found.</p> : null}
            <ul className="grid gap-1">
              {items.map((item) => (
                <li key={item.zohoItemId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="font-mono">{item.itemCode || item.zohoItemId}</span> · {item.itemName || DASH}
                    <span className="ml-2 text-xs opacity-70">available {fmtInt(item.availableForSale)}</span>
                  </span>
                  <button type="button" className="ainv-btn" disabled={!!saving} onClick={() => void choose(item.zohoItemId, false)}>
                    {saving === item.zohoItemId ? 'Saving…' : 'Map'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {error ? <div className="ainv-banner ainv-banner--rose">{error}</div> : null}
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Saving changes only this app&apos;s mapping. Nothing is changed in Amazon or Zoho.</p>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className="ainv-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function ParamsEditor({ row, onSaved }: { row: SkuMasterRow; onSaved: (row: SkuMasterRow) => void }) {
  const [pack, setPack] = useState(String(row.packMultiplier ?? 1))
  const [carton, setCarton] = useState(row.cartonQuantity == null ? '' : String(row.cartonQuantity))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = pack !== String(row.packMultiplier ?? 1) || carton !== (row.cartonQuantity == null ? '' : String(row.cartonQuantity))

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      onSaved(await updateKsaSkuParameters(row.id, { packMultiplier: Number(pack), cartonQuantity: carton.trim() === '' ? null : Number(carton) }))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <input className="ainv-input w-20" aria-label="Pack multiplier" inputMode="decimal" value={pack} onChange={(e) => setPack(e.target.value)} />
      <input className="ainv-input w-24" aria-label="Carton quantity" inputMode="numeric" placeholder="carton" value={carton} onChange={(e) => setCarton(e.target.value)} />
      {dirty ? (
        <button type="button" className="ainv-btn" disabled={saving} onClick={() => void save()}>
          {saving ? '…' : 'Save'}
        </button>
      ) : null}
      {error ? <span className="w-full text-xs" style={{ color: 'var(--danger, #e11d48)' }}>{error}</span> : null}
    </div>
  )
}

function SettingsPanel() {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const fill = (res: SettingsResponse) => {
    setData(res)
    const s = res.settings
    setForm({
      lowStockUnitsThreshold: String(s.lowStockUnitsThreshold),
      targetCoverDays: String(s.targetCoverDays),
      maxCoverDays: String(s.maxCoverDays),
      defaultLeadTimeDays: String(s.defaultLeadTimeDays),
      defaultCartonQuantity: s.defaultCartonQuantity == null ? '' : String(s.defaultCartonQuantity),
      vatRate: String(s.vatRate),
      ...Object.fromEntries(THRESHOLD_FIELDS.map((f) => [f.key, s[f.key] == null ? '' : String(s[f.key])])),
    })
  }

  useEffect(() => {
    getKsaSettings().then(fill).catch((err) => setError(errorText(err)))
  }, [])

  const save = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const patch: SettingsPatch = {
        lowStockUnitsThreshold: Number(form.lowStockUnitsThreshold),
        targetCoverDays: Number(form.targetCoverDays),
        maxCoverDays: Number(form.maxCoverDays),
        defaultLeadTimeDays: Number(form.defaultLeadTimeDays),
        defaultCartonQuantity: form.defaultCartonQuantity.trim() === '' ? null : Number(form.defaultCartonQuantity),
        vatRate: Number(form.vatRate),
        ...Object.fromEntries(THRESHOLD_FIELDS.filter((f) => (form[f.key] ?? '').trim() !== '').map((f) => [f.key, Number(form[f.key])])),
      }
      const settings = await updateKsaSettings(patch)
      if (data) fill({ ...data, settings })
      setMessage('Saved.')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  const field = (key: string, label: string, hint?: string) => (
    <label className="ainv-label" key={key}>
      {label}
      <input className="ainv-input" value={form[key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
      {hint ? <span className="text-xs font-normal opacity-70">{hint}</span> : null}
    </label>
  )

  return (
    <section className="ainv-panel">
      <h2 className="ainv-section-title">Marketplace settings</h2>
      {data ? (
        <>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-dim)' }}>
            Timezone {data.settings.timezone}. Automatic refresh is{' '}
            {data.schedulerEnvEnabled && data.settings.schedulerEnabled ? 'on' : 'off'}
            {data.schedulerEnvEnabled ? '' : ' (disabled on the server)'}; schedules:{' '}
            {data.schedules.map((s) => `${s.jobType} every ${s.intervalMinutes}m${s.enabled ? '' : ' (off)'}`).join(', ') || DASH}.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {field('lowStockUnitsThreshold', 'Low stock threshold (units)', 'Used by the Low Stock table')}
            {field('targetCoverDays', 'Target cover days')}
            {field('maxCoverDays', 'Max cover days')}
            {field('defaultLeadTimeDays', 'Default lead time (days)')}
            {field('defaultCartonQuantity', 'Default carton quantity', 'Blank = not set')}
            {field('vatRate', 'VAT rate', 'e.g. 0.15 — used to compute sales excluding VAT')}
          </div>
          <h3 className="mt-5 text-sm font-semibold">Inventory health &amp; capacity thresholds</h3>
          <div className="mt-2 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            <label className="ainv-label">
              Aged from (days)
              <select className="ainv-input" value={form.healthAgedMinDays ?? ''} onChange={(e) => setForm((f) => ({ ...f, healthAgedMinDays: e.target.value }))}>
                {[91, 181, 271, 366].map((d) => <option key={d} value={String(d)}>{d}+ days</option>)}
              </select>
              <span className="text-xs font-normal opacity-70">Amazon age bucket boundary</span>
            </label>
            {THRESHOLD_FIELDS.filter((f) => f.key !== 'healthAgedMinDays').map((f) => field(f.key, f.label, f.hint))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" className="ainv-btn ainv-btn--primary-emerald" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            {message ? <span className="text-sm">{message}</span> : null}
          </div>
        </>
      ) : null}
      {error ? <div className="ainv-banner ainv-banner--rose mt-3">{error}</div> : null}
    </section>
  )
}

export default function AmazonKsaSkuMappingPage() {
  const [status, setStatus] = useState<MappingStatus | ''>('REVIEW_REQUIRED')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [offset, setOffset] = useState(0)
  const [list, setList] = useState<SkuMasterList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyRow, setBusyRow] = useState<number | null>(null)
  const [editing, setEditing] = useState<SkuMasterRow | null>(null)
  const [backfillDays, setBackfillDays] = useState('365')

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setOffset(0)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(await listKsaSkuMaster({ status, search, activeOnly, limit: PAGE_SIZE, offset }))
      setError('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }, [status, search, activeOnly, offset])

  useEffect(() => {
    void load()
  }, [load])

  const jobs = useRefreshRun({
    watchJobTypes: ['listings', 'warehouse_stock', 'fba_inventory', 'sales_backfill', 'rollup', 'listing_status', 'inventory_reports', 'removal_orders'],
    onFinished: () => void load(),
  })

  const replaceRow = (row: SkuMasterRow) => {
    setList((prev) => (prev ? { ...prev, rows: prev.rows.map((r) => (r.id === row.id ? row : r)) } : prev))
  }

  const rowAction = async (row: SkuMasterRow, action: () => Promise<SkuMasterRow>) => {
    setBusyRow(row.id)
    setError('')
    try {
      replaceRow(await action())
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusyRow(null)
    }
  }

  const startBackfill = () => {
    const days = Number(backfillDays)
    if (!Number.isInteger(days) || days < 1 || days > 730) {
      setError('Backfill days must be a whole number between 1 and 730.')
      return
    }
    const ok = window.confirm(
      `Load about ${days} days of KSA order history from Amazon order reports? This runs in the background, ` +
        'requests one report per 30-day window (about one per minute) and never deletes existing data.',
    )
    if (ok) void jobs.startBackfill(days)
  }

  const counts = list?.statusCounts
  const rows = list?.rows || []
  const total = list?.total || 0

  return (
    <div className="ainv-page mx-auto flex max-w-[120rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="ainv-page__header">
        <p className="ainv-page__eyebrow ainv-page__eyebrow--amber">Amazon KSA · Settings</p>
        <h1 className="ainv-page__title">SKU Mapping</h1>
        <p className="ainv-page__lead">
          Link each Amazon KSA seller SKU to its Life Smile Zoho item. Auto matches are suggestions until confirmed. Changes are saved
          only in this app — nothing is sent to Amazon or Zoho. <Link className="ainv-link-emerald" to="/amazon-ksa/command-center">Back to Command Center</Link>
        </p>
      </header>

      <section className="ainv-panel">
        <h2 className="ainv-section-title">Data refresh</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <button type="button" className="ainv-btn" disabled={jobs.busy} onClick={() => void jobs.start('listings')}>Refresh listings</button>
          <button type="button" className="ainv-btn" disabled={jobs.busy} onClick={() => void jobs.start('warehouse_stock')}>Refresh warehouse stock</button>
          <button type="button" className="ainv-btn" disabled={jobs.busy} onClick={() => void jobs.start('fba_inventory')}>Refresh FBA inventory</button>
          <button type="button" className="ainv-btn" disabled={jobs.busy} onClick={() => void jobs.start('rollup')}>Rebuild daily sales</button>
          <button type="button" className="ainv-btn" disabled={jobs.busy} onClick={() => void jobs.start('listing_status')}>Refresh listing status</button>
          <button type="button" className="ainv-btn" disabled={jobs.busy} onClick={() => void jobs.start('inventory_reports')}>Refresh inventory reports</button>
          <button type="button" className="ainv-btn" disabled={jobs.busy} onClick={() => void jobs.start('removal_orders')}>Refresh removal orders</button>
          <label className="ainv-label ml-auto">
            Sales history backfill (days)
            <input className="ainv-input w-28" inputMode="numeric" value={backfillDays} onChange={(e) => setBackfillDays(e.target.value)} />
          </label>
          <button type="button" className="ainv-btn ainv-btn--amber" disabled={jobs.busy} onClick={startBackfill}>Start backfill</button>
        </div>
        {jobs.error ? <div className="ainv-banner ainv-banner--rose mt-3">{jobs.error}</div> : null}
        {jobs.run ? <div className="mt-3"><RunProgress run={jobs.run} /></div> : null}
      </section>

      <SettingsPanel />

      <section className="ainv-panel overflow-hidden p-0">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value || 'all'}
                type="button"
                className={`ainv-btn ${status === f.value ? 'ainv-btn--primary-sky' : ''}`}
                onClick={() => {
                  setStatus(f.value)
                  setOffset(0)
                }}
              >
                {f.label}
                {f.value && counts ? ` (${fmtInt(counts[f.value])})` : ''}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="ainv-label">
              Search SKU / ASIN / title / item
              <input className="ainv-input w-72" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={activeOnly} onChange={(e) => { setActiveOnly(e.target.checked); setOffset(0) }} />
              Active listings only
            </label>
          </div>
        </div>
        {error ? <div className="ainv-banner ainv-banner--rose mx-4 mb-3">{error}</div> : null}
        {loading && !list ? (
          <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : rows.length ? (
          <div className="ainv-table-wrap overflow-x-auto">
            <table className="ainv-table w-full min-w-[90rem] text-left text-sm">
              <thead>
                <tr>
                  <th>Amazon SKU</th>
                  <th>ASIN</th>
                  <th>Title</th>
                  <th>Mapped Zoho Item</th>
                  <th>Item Code</th>
                  <th>Match Method</th>
                  <th className="text-right">Confidence</th>
                  <th>Status</th>
                  <th>Pack Multiplier / Carton Qty</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.active ? '' : 'ainv-table__status-inactive'}>
                    <td className="ainv-table__sku font-mono">
                      {r.sellerSku}
                      {!r.active ? <div className="text-xs opacity-60">not in active listings</div> : null}
                      {r.amazonListingStatus ? (
                        <div className="mt-1"><ListingStatusBadge status={r.amazonListingStatus} title={r.amazonListingStatusReason} /></div>
                      ) : null}
                    </td>
                    <td className="font-mono">{r.asin || DASH}</td>
                    <td className="max-w-xs truncate" title={r.amazonTitle || ''}>{r.amazonTitle || DASH}</td>
                    <td className="max-w-xs truncate" title={r.zohoItemName || ''}>
                      {r.zohoItemName || DASH}
                      {r.mappingStatus === 'REVIEW_REQUIRED' && r.mappingCandidates.length > 1 ? (
                        <div className="text-xs opacity-70">{r.mappingCandidates.length} possible items</div>
                      ) : null}
                    </td>
                    <td className="font-mono">{r.zohoItemCode || DASH}</td>
                    <td className="text-xs">{r.mappingMethod ? METHOD_LABEL[r.mappingMethod] || r.mappingMethod : DASH}</td>
                    <td className="text-right">{r.mappingConfidence == null ? DASH : `${Math.round(r.mappingConfidence * 100)}%`}</td>
                    <td>
                      <MappingBadge status={r.mappingStatus} />
                      {r.confirmedAt ? <div className="text-xs opacity-60" title={r.confirmedBy || ''}>{fmtDateTime(r.confirmedAt)}</div> : null}
                    </td>
                    <td><ParamsEditor key={`${r.id}-${r.updatedAt}`} row={r} onSaved={replaceRow} /></td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {r.zohoItemId && r.mappingStatus !== 'CONFIRMED' && r.mappingStatus !== 'REVIEW_REQUIRED' ? (
                          <button type="button" className="ainv-btn ainv-btn--primary-emerald" disabled={busyRow === r.id} onClick={() => void rowAction(r, () => confirmKsaSku(r.id))}>
                            Confirm
                          </button>
                        ) : null}
                        <button type="button" className="ainv-btn" disabled={busyRow === r.id} onClick={() => setEditing(r)}>
                          {r.zohoItemId ? 'Change mapping' : 'Map'}
                        </button>
                        {r.mappingStatus !== 'UNMAPPED' ? (
                          <button
                            type="button"
                            className="ainv-btn"
                            disabled={busyRow === r.id}
                            onClick={() => {
                              if (window.confirm(`Mark ${r.sellerSku} as unmapped? Auto-matching will not re-map it.`)) void rowAction(r, () => unmapKsaSku(r.id))
                            }}
                          >
                            Mark unmapped
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {total === 0 && !search && !status ? 'No SKUs yet — run Refresh listings (or Refresh All on the Command Center).' : 'No SKUs match this filter.'}
          </div>
        )}
        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-2 p-4 text-sm">
            <span>{fmtInt(offset + 1)}–{fmtInt(Math.min(offset + PAGE_SIZE, total))} of {fmtInt(total)}</span>
            <div className="flex gap-2">
              <button type="button" className="ainv-pagination-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
              <button type="button" className="ainv-pagination-btn" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
            </div>
          </div>
        ) : null}
      </section>

      {editing ? (
        <MappingDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            replaceRow(row)
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}
