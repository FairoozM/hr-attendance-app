import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  downloadInitialDraft,
  downloadInitialDraftReport,
  getImageBatches,
  getInitialDraftHealth,
  previewInitialDraft,
  type CellRecord,
  type ImageBatchesResponse,
  type InitialDraftHealth,
  type InitialDraftPreview,
  type PreviewRow,
} from '../api/amazonInitialDraft'
import AmazonProductImagesSection from './amazonInitialDraft/AmazonProductImagesSection'

type RowFilter = 'all' | 'matched' | 'unmatched' | 'ambiguous' | 'duplicates' | 'conflicts'
type DetailTab = 'populated' | 'conflicts' | 'preserved' | 'missing' | 'columns' | 'surplus' | 'backend'

const ROW_FILTERS: Array<{ id: RowFilter; label: string }> = [
  { id: 'all', label: 'All rows' },
  { id: 'matched', label: 'Matched' },
  { id: 'unmatched', label: 'Unmatched' },
  { id: 'ambiguous', label: 'Ambiguous' },
  { id: 'duplicates', label: 'Duplicate SKU' },
  { id: 'conflicts', label: 'Has conflicts' },
]

const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'populated', label: 'Populated fields' },
  { id: 'conflicts', label: 'Preserved conflicts' },
  { id: 'preserved', label: 'Preserved existing' },
  { id: 'missing', label: 'Missing values' },
  { id: 'columns', label: 'Untouched columns' },
  { id: 'surplus', label: 'Features beyond template' },
  { id: 'backend', label: 'Report-only data' },
]

const CARD = 'rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md'
const STAT = 'rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm'
const BUTTON = 'rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'
const TH = 'sticky top-0 z-10 bg-slate-900/95 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 backdrop-blur'
const TD = 'px-3 py-2 align-top text-slate-200'

function StatusPill({ row }: { row: PreviewRow }) {
  const tone =
    row.status === 'matched'
      ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30'
      : row.status === 'ambiguous'
        ? 'bg-amber-500/15 text-amber-200 ring-amber-400/30'
        : 'bg-rose-500/15 text-rose-200 ring-rose-400/30'
  return (
    <span className={`inline-flex rounded-lg px-2 py-0.5 text-[11px] font-semibold ring-1 ${tone}`}>{row.status}</span>
  )
}

function Stat({ label, value, tone = 'text-white' }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className={STAT}>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  )
}

export default function AmazonInitialDraftPage() {
  const [health, setHealth] = useState<InitialDraftHealth | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<InitialDraftPreview | null>(null)
  const [busy, setBusy] = useState<'' | 'preview' | 'draft' | 'report'>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [rowFilter, setRowFilter] = useState<RowFilter>('all')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<DetailTab>('populated')
  const [imageBatches, setImageBatches] = useState<ImageBatchesResponse | null>(null)
  const [imageBatch, setImageBatch] = useState('')

  useEffect(() => {
    let cancelled = false
    getInitialDraftHealth()
      .then((result) => {
        if (!cancelled) setHealth(result)
      })
      .catch(() => {
        if (!cancelled) setHealth(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getImageBatches()
      .then((result) => {
        if (!cancelled) setImageBatches(result)
      })
      .catch(() => {
        // The image section is optional; the draft still generates without it.
        if (!cancelled) setImageBatches(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const run = useCallback(
    async <T,>(kind: 'preview' | 'draft' | 'report', task: () => Promise<T>, success?: (value: T) => string) => {
      setBusy(kind)
      setError('')
      setNotice('')
      try {
        const value = await task()
        if (success) setNotice(success(value))
        return value
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
        return null
      } finally {
        setBusy('')
      }
    },
    []
  )

  const handleFileChange = (next: File | null) => {
    setFile(next)
    setPreview(null)
    setError('')
    setNotice('')
  }

  const handlePreview = async () => {
    if (!file) return
    const result = await run('preview', () => previewInitialDraft(file, imageBatch))
    if (result) {
      setPreview(result)
      setRowFilter('all')
      setSearch('')
    }
  }

  const filteredRows = useMemo(() => {
    if (!preview) return []
    const needle = search.trim().toLowerCase()
    return preview.rows.filter((row) => {
      if (rowFilter === 'matched' && row.status !== 'matched') return false
      if (rowFilter === 'unmatched' && row.status !== 'unmatched') return false
      if (rowFilter === 'ambiguous' && row.status !== 'ambiguous') return false
      if (rowFilter === 'duplicates' && !row.duplicateSkuInUpload) return false
      if (rowFilter === 'conflicts' && row.counts.conflicts === 0) return false
      if (!needle) return true
      return (
        row.sku.toLowerCase().includes(needle) ||
        (row.productName || '').toLowerCase().includes(needle)
      )
    })
  }, [preview, rowFilter, search])

  const cellRows: CellRecord[] = useMemo(() => {
    if (!preview) return []
    if (tab === 'populated') return preview.populated.items
    if (tab === 'conflicts') return preview.conflicts.items
    if (tab === 'preserved') return preview.preservedIdentical.items
    if (tab === 'missing') return preview.missingValues.items
    return []
  }, [preview, tab])

  const catalogReady = Boolean(health?.catalog?.configured && health?.catalog?.reachable)

  return (
    <div className="mx-auto flex max-w-[120rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-white/10 bg-gradient-to-br from-amber-600/10 via-transparent to-slate-900/40 p-6 backdrop-blur-xl">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200/80">Admin · Amazon UAE</p>
          <h1 className="mt-1 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
            Initial Draft Generator
          </h1>
          <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-400">
            Upload an Amazon flat-file template containing your seller SKUs. Matching products are read from the website
            catalog and written into blank cells only. Your product type stays exactly as you set it, existing values are
            never overwritten, and the workbook comes back with its macros, dropdowns and formatting intact.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-xs">
          <span
            className={`rounded-lg px-3 py-1 font-semibold ring-1 ${
              catalogReady
                ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30'
                : 'bg-rose-500/15 text-rose-200 ring-rose-400/30'
            }`}
          >
            {health === null
              ? 'Checking catalog…'
              : catalogReady
                ? `Catalog connected${health?.catalog?.readOnly ? ' · read-only' : ''}`
                : 'Catalog unavailable'}
          </span>
          {health?.catalog?.role ? (
            <span className="text-slate-500">
              role {health.catalog.role} · {health.catalog.database}
            </span>
          ) : null}
        </div>
      </header>

      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-100">
        Initial Draft — requires content enhancement and final Amazon validation before upload.
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </div>
      ) : null}

      <section className={CARD}>
        <h2 className="text-lg font-bold text-white">1 · Upload the Amazon template</h2>
        <p className="mt-1 text-sm text-slate-400">
          The file you upload is never modified or stored. Choose an approved image batch to fill the main and secondary
          image URL columns as well. Price and quantity are always left blank.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex min-w-[22rem] flex-1 flex-col text-sm">
            <span className="mb-1 font-semibold text-slate-300">Template file (.xlsm or .xlsx)</span>
            <input
              type="file"
              accept=".xlsm,.xlsx"
              onChange={(event) => handleFileChange(event.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-amber-500/20 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-amber-100"
            />
          </label>
          <button
            type="button"
            onClick={handlePreview}
            disabled={!file || busy !== '' || !catalogReady}
            className={`${BUTTON} bg-amber-500 text-slate-950 hover:bg-amber-400`}
          >
            {busy === 'preview' ? 'Analysing…' : 'Analyse template'}
          </button>
        </div>
        {file ? (
          <p className="mt-3 text-xs text-slate-500">
            {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
          </p>
        ) : null}
        {!catalogReady && health !== null ? (
          <p className="mt-3 text-xs text-rose-300">
            {health?.catalog?.configured
              ? `The catalog connection is configured but not reachable. ${health?.catalog?.error || ''}`
              : 'The website catalog connection is not configured on this server yet, so SKUs cannot be matched.'}
          </p>
        ) : null}

        <div className="mt-5 border-t border-white/10 pt-4">
          <label className="flex max-w-2xl flex-col text-sm">
            <span className="mb-1 font-semibold text-slate-300">Approved Amazon image batch (optional)</span>
            <select
              value={imageBatch}
              onChange={(event) => setImageBatch(event.target.value)}
              disabled={!imageBatches || Boolean(imageBatches.configuration.problem)}
              className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              <option value="">No images — leave the image columns unchanged</option>
              {(imageBatches?.batches || [])
                .filter((batch) => batch.available)
                .map((batch) => (
                  <option key={batch.prefix} value={batch.prefix}>
                    {batch.label}
                  </option>
                ))}
            </select>
          </label>
          {imageBatches?.configuration?.problem ? (
            <p className="mt-2 text-xs text-amber-300">
              Image matching is unavailable: {imageBatches.configuration.problem}. The draft still generates and every
              image cell is left exactly as uploaded.
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              Every folder in the approved marketplace-image bucket is offered, so a folder added there shows up here on
              the next page load. The batch is the only image input sent from this page.
            </p>
          )}
          {imageBatches?.batches?.some((batch) => !batch.available) ? (
            <p className="mt-2 text-xs text-rose-300">
              Some approved prefixes could not be listed:{' '}
              {imageBatches.batches
                .filter((batch) => !batch.available)
                .map((batch) => `${batch.prefix} (${batch.reason})`)
                .join(', ')}
            </p>
          ) : null}
        </div>
      </section>

      {preview ? (
        <>
          <section className={CARD}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white">2 · Review the draft</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Sheet <span className="font-semibold text-slate-200">{preview.summary.sheetName}</span> · technical
                  headers on row {preview.summary.headerRow} · data from row {preview.summary.firstDataRow} (
                  {preview.summary.firstDataRowBasis}) · SKU column {preview.summary.skuColumn} ·{' '}
                  {preview.summary.templateColumns} columns detected
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    file &&
                    run('draft', () => downloadInitialDraft(file, imageBatch), (name) => `Draft downloaded as ${name}`)
                  }
                  disabled={busy !== ''}
                  className={`${BUTTON} bg-emerald-500 text-white hover:bg-emerald-400`}
                >
                  {busy === 'draft' ? 'Building…' : 'Download Amazon draft'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    file &&
                    run(
                      'report',
                      () => downloadInitialDraftReport(file, imageBatch),
                      (name) => `Report downloaded as ${name}`
                    )
                  }
                  disabled={busy !== ''}
                  className={`${BUTTON} bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/15`}
                >
                  {busy === 'report' ? 'Building…' : 'Download report'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <Stat label="Matched" value={preview.summary.matched} tone="text-emerald-300" />
              <Stat label="Unmatched" value={preview.summary.unmatched} tone="text-rose-300" />
              <Stat label="Ambiguous" value={preview.summary.ambiguous} tone="text-amber-300" />
              <Stat label="Cells filled" value={preview.summary.populatedCells} tone="text-sky-300" />
              <Stat label="Conflicts kept" value={preview.summary.conflictCells} tone="text-amber-300" />
              <Stat label="Left blank" value={preview.summary.missingCells} tone="text-slate-300" />
              <Stat label="Duplicate SKU rows" value={preview.summary.duplicateSkuRows} tone="text-amber-300" />
            </div>
          </section>

          <AmazonProductImagesSection images={preview.images} />

          <section className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-white">Rows</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Filter by SKU or product"
                  className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
                {ROW_FILTERS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setRowFilter(option.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      rowFilter === option.id
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 max-h-[28rem] overflow-auto rounded-2xl border border-white/10">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={TH}>Row</th>
                    <th className={TH}>Seller SKU</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Matched on</th>
                    <th className={TH}>Product</th>
                    <th className={`${TH} text-right`}>Filled</th>
                    <th className={`${TH} text-right`}>Kept</th>
                    <th className={`${TH} text-right`}>Conflicts</th>
                    <th className={`${TH} text-right`}>Blank</th>
                    <th className={TH}>Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredRows.map((row) => (
                    <tr key={`${row.rowNumber}-${row.sku}`} className="hover:bg-white/[0.03]">
                      <td className={`${TD} text-slate-500`}>{row.rowNumber}</td>
                      <td className={`${TD} font-mono text-xs font-semibold text-white`}>{row.sku}</td>
                      <td className={TD}>
                        <StatusPill row={row} />
                      </td>
                      <td className={`${TD} text-xs text-slate-400`}>
                        {row.matchSource || '—'}
                        {row.matchKind === 'case-insensitive' ? (
                          <span
                            className="ml-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300"
                            title={`Matched the catalog code ${row.catalogItemCode} by ignoring letter case. Your SKU text is unchanged.`}
                          >
                            case
                          </span>
                        ) : null}
                      </td>
                      <td className={`${TD} max-w-[28rem] truncate text-slate-300`}>{row.productName || '—'}</td>
                      <td className={`${TD} text-right text-emerald-300`}>{row.counts.populated || ''}</td>
                      <td className={`${TD} text-right text-slate-400`}>{row.counts.preserved || ''}</td>
                      <td className={`${TD} text-right text-amber-300`}>{row.counts.conflicts || ''}</td>
                      <td className={`${TD} text-right text-slate-500`}>{row.counts.missing || ''}</td>
                      <td className={`${TD} text-xs text-slate-500`}>
                        {row.duplicateSkuInUpload ? 'Duplicate SKU in upload. ' : ''}
                        {row.reason || ''}
                        {row.candidates.length > 1
                          ? ` (${row.candidates.length} candidates: ${row.candidates
                              .map((c) => c.productName)
                              .join(' | ')})`
                          : ''}
                      </td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td className={`${TD} text-center text-slate-500`} colSpan={10}>
                        No rows match this filter.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              {DETAIL_TABS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setTab(option.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    tab === option.id ? 'bg-white/15 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-4 max-h-[28rem] overflow-auto rounded-2xl border border-white/10">
              {tab === 'columns' ? (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={TH}>Col</th>
                      <th className={TH}>Field</th>
                      <th className={TH}>Technical header</th>
                      <th className={TH}>Why it is untouched</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {[
                      ...preview.neverWriteColumns.items.map((c) => ({ ...c, why: `Policy: ${c.reason}` })),
                      ...preview.additionalSlotColumns.items.map((c) => ({ ...c, why: c.note || '' })),
                      ...preview.ignoredColumns.items.map((c) => ({
                        ...c,
                        why: c.note || 'No universal mapping — fill this yourself.',
                      })),
                    ].map((column) => (
                      <tr key={`${column.column}-${column.technicalHeader}`} className="hover:bg-white/[0.03]">
                        <td className={`${TD} font-mono text-xs text-slate-400`}>{column.column}</td>
                        <td className={TD}>{column.displayLabel || '—'}</td>
                        <td className={`${TD} font-mono text-[11px] text-slate-400`}>{column.technicalHeader}</td>
                        <td className={`${TD} text-xs text-slate-500`}>{column.why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : tab === 'backend' || tab === 'surplus' ? (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={TH}>Row</th>
                      <th className={TH}>SKU</th>
                      <th className={TH}>{tab === 'surplus' ? 'Feature' : 'Backend field'}</th>
                      <th className={TH}>Value</th>
                      <th className={TH}>Why not written</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(tab === 'surplus' ? preview.surplusListValues : preview.reportOnlyFields).items.map((entry, index) => (
                      <tr key={`${entry.rowNumber}-${entry.field}-${index}`} className="hover:bg-white/[0.03]">
                        <td className={`${TD} text-slate-500`}>{entry.rowNumber}</td>
                        <td className={`${TD} font-mono text-xs`}>{entry.sku}</td>
                        <td className={`${TD} text-slate-300`}>{entry.field}</td>
                        <td className={`${TD} max-w-[32rem] truncate`}>{entry.value}</td>
                        <td className={`${TD} text-xs text-slate-500`}>{entry.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={TH}>Row</th>
                      <th className={TH}>SKU</th>
                      <th className={TH}>Col</th>
                      <th className={TH}>Field</th>
                      <th className={TH}>{tab === 'populated' ? 'Value written' : 'Value in workbook'}</th>
                      <th className={TH}>{tab === 'conflicts' ? 'Database value (not written)' : 'Detail'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {cellRows.map((entry, index) => (
                      <tr key={`${entry.rowNumber}-${entry.column}-${index}`} className="hover:bg-white/[0.03]">
                        <td className={`${TD} text-slate-500`}>{entry.rowNumber}</td>
                        <td className={`${TD} font-mono text-xs`}>{entry.sku}</td>
                        <td className={`${TD} font-mono text-xs text-slate-400`}>{entry.column}</td>
                        <td className={TD}>{entry.displayLabel}</td>
                        <td className={`${TD} max-w-[30rem] truncate`}>
                          {tab === 'populated' ? entry.value : entry.existingValue || '—'}
                        </td>
                        <td className={`${TD} max-w-[24rem] truncate text-xs text-slate-500`}>
                          {tab === 'conflicts'
                            ? entry.databaseValue
                            : tab === 'populated'
                              ? `${entry.source}${entry.isConstant ? ' (constant)' : ''}`
                              : `${entry.reason || ''}${entry.rawValue ? ` — ${entry.rawValue}` : ''}`}
                        </td>
                      </tr>
                    ))}
                    {cellRows.length === 0 ? (
                      <tr>
                        <td className={`${TD} text-center text-slate-500`} colSpan={6}>
                          Nothing to show here.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
