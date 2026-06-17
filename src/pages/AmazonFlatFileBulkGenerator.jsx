import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { downloadBlob } from '../api/client'
import {
  uploadListingBatch,
  getListingBatch,
  getDefaultProfiles,
  createDefaultProfile,
  applyBatchDefaults,
  validateListingBatch,
  startBatchGeneration,
  getBatchGenerationStatus,
  cancelBatchGeneration,
  generateListingRow,
  updateListingRow,
  listingBatchBulkAction,
  exportListingBatch,
} from '../api/listingBatches'
import { BatchStepper } from '../components/listings/BatchStepper'
import { BulkUploadStep } from '../components/listings/BulkUploadStep'
import { BatchSummaryCards } from '../components/listings/BatchSummaryCards'
import { BatchDefaultsRules } from '../components/listings/BatchDefaultsRules'
import { ListingBatchTable } from '../components/listings/ListingBatchTable'
import { GenerationProgressPanel } from '../components/listings/GenerationProgressPanel'
import { ListingRowDrawer } from '../components/listings/ListingRowDrawer'
import { DefaultProfileEditor } from '../components/listings/DefaultProfileEditor'

export function AmazonFlatFileBulkGenerator() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [file, setFile] = useState(null)
  const [batchName, setBatchName] = useState('')
  const [batch, setBatch] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [selected, setSelected] = useState([])
  const [openRow, setOpenRow] = useState(null)
  const [job, setJob] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState({ search: '', status: '' })
  const [generationMode, setGenerationMode] = useState('balanced')

  const batchId = batch?.id || searchParams.get('batch')
  const currentStep = useMemo(() => {
    if (!batch) return 0
    const counts = batch.summary_counts || {}
    if (counts.Exported) return 6
    if (counts.Generated || counts['Needs Review'] || counts.Approved) return 5
    if (counts.Ready || counts['Validation Error']) return 4
    return 2
  }, [batch])

  async function loadBatch(id = batchId, params = filter) {
    if (!id) return
    const res = await getListingBatch(id, { ...params, limit: 50 })
    setBatch(res.batch)
  }

  useEffect(() => {
    getDefaultProfiles().then((res) => setProfiles(res.items || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (batchId) loadBatch(batchId).catch((err) => setError(err.message || 'Failed to load batch'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId])

  useEffect(() => {
    if (!batchId) return undefined
    const t = setInterval(() => {
      getBatchGenerationStatus(batchId)
        .then((res) => {
          setJob(res.job || null)
          if (res.job && !res.job.running) loadBatch(batchId).catch(() => {})
        })
        .catch(() => {})
    }, 2500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId])

  async function run(label, fn) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await fn()
      setMessage(label)
      return result
    } catch (err) {
      setError(err.message || 'Request failed')
      throw err
    } finally {
      setBusy(false)
    }
  }

  async function handleUpload() {
    const res = await run('Batch uploaded.', () => uploadListingBatch(file, batchName))
    const id = res.batch?.id
    if (id) {
      setSearchParams({ batch: String(id) })
      setBatch(res.batch)
      if (res.batch.warning) setError(res.batch.warning)
    }
  }

  async function refreshWithFilter(next = filter) {
    setFilter(next)
    await loadBatch(batchId, next)
  }

  async function handleExport(approvedOnly = false) {
    const out = await run('Export ready.', () => exportListingBatch(batch.id, { approvedOnly }))
    downloadBlob(out.blob, out.filename || 'amazon-flat-file-completed.xlsx')
    await loadBatch()
  }

  const rows = batch?.rows || []
  const columns = batch?.detected_columns || []

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-600/10 via-transparent to-violet-600/10 p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300/90">Amazon Flat File Bulk Generator</p>
        <h1 className="mt-1 text-3xl font-bold text-white">Life Smile bulk listing workflow</h1>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-400">
          Upload Seller Central flat files, preserve the Template sheet, apply safe defaults, validate rows, generate AI listing
          content in a controlled queue, review exceptions, and export back to Amazon format.
        </p>
      </header>

      <BatchStepper currentStep={currentStep} />
      {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}
      {message ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{message}</div> : null}

      <BulkUploadStep file={file} batchName={batchName} busy={busy} onFileChange={setFile} onBatchNameChange={setBatchName} onUpload={handleUpload} />

      {batch ? (
        <>
          <BatchSummaryCards batch={batch} />
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">{batch.batch_name}</h2>
                <p className="text-sm text-slate-400">
                  {batch.imported_count} / 330 SKUs imported from {batch.template_sheet_name}. Active columns: {batch.active_columns?.length || 0}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => run('Validation complete.', async () => { await validateListingBatch(batch.id); await loadBatch() })} className="rounded-xl px-3 py-2 text-xs font-bold text-slate-200 ring-1 ring-white/10 disabled:opacity-50">Validate</button>
                <select value={generationMode} onChange={(e) => setGenerationMode(e.target.value)} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs font-bold text-white">
                  <option value="fast">Fast: 50-100 SKUs</option>
                  <option value="balanced">Balanced: 100-250 SKUs</option>
                  <option value="careful">Careful: 250-330 SKUs</option>
                </select>
                <button disabled={busy} onClick={() => run('Generation started.', async () => { const res = await startBatchGeneration(batch.id, { mode: generationMode, rowIds: selected }); setJob(res.job) })} className="rounded-xl bg-violet-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Generate selected/ready</button>
                <button disabled={busy} onClick={() => handleExport(false)} className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Export all</button>
                <button disabled={busy} onClick={() => handleExport(true)} className="rounded-xl px-3 py-2 text-xs font-bold text-emerald-100 ring-1 ring-emerald-400/40 disabled:opacity-50">Export approved</button>
              </div>
            </div>
          </section>
          <BatchDefaultsRules batch={batch} profiles={profiles} busy={busy} onApply={(body) => run('Defaults applied.', async () => { await applyBatchDefaults(batch.id, body); await loadBatch() })} />
          <DefaultProfileEditor
            columns={columns}
            busy={busy}
            onCreate={(body) => run('Default profile saved.', async () => {
              await createDefaultProfile(body)
              const res = await getDefaultProfiles()
              setProfiles(res.items || [])
            })}
          />
          <GenerationProgressPanel job={job} onCancel={() => cancelBatchGeneration(batch.id).then((res) => setJob(res.job))} />
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <input value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} placeholder="Search SKU/name" className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white" />
              <select value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white">
                <option value="">All statuses</option>
                {['Imported','Validation Error','Ready','Queued','Generating','Generated','Needs Review','Approved','Saved','Exported','Failed'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button type="button" onClick={() => refreshWithFilter()} className="rounded-xl px-3 py-2 text-xs font-bold text-slate-200 ring-1 ring-white/10">Filter</button>
              <button type="button" disabled={!selected.length} onClick={() => run('Selected rows approved.', async () => { await listingBatchBulkAction(batch.id, { action: 'approve', rowIds: selected }); setSelected([]); await loadBatch() })} className="rounded-xl px-3 py-2 text-xs font-bold text-emerald-100 ring-1 ring-emerald-400/40 disabled:opacity-50">Approve selected</button>
              <button type="button" onClick={() => run('High-score rows approved.', async () => { await listingBatchBulkAction(batch.id, { action: 'approve_high_score' }); await loadBatch() })} className="rounded-xl px-3 py-2 text-xs font-bold text-emerald-100 ring-1 ring-emerald-400/40">Approve high-score</button>
              <button type="button" disabled={!selected.length} onClick={() => run('Selected rows saved.', async () => { await listingBatchBulkAction(batch.id, { action: 'save', rowIds: selected }); setSelected([]); await loadBatch() })} className="rounded-xl px-3 py-2 text-xs font-bold text-sky-100 ring-1 ring-sky-400/40 disabled:opacity-50">Save selected</button>
              <button type="button" disabled={!selected.length} onClick={() => run('Selected rows deleted.', async () => { await listingBatchBulkAction(batch.id, { action: 'delete', rowIds: selected }); setSelected([]); await loadBatch() })} className="rounded-xl px-3 py-2 text-xs font-bold text-rose-100 ring-1 ring-rose-400/40 disabled:opacity-50">Delete selected</button>
              <button type="button" onClick={() => run('Failed rows queued.', async () => { await listingBatchBulkAction(batch.id, { action: 'retry_failed' }); await loadBatch() })} className="rounded-xl px-3 py-2 text-xs font-bold text-amber-100 ring-1 ring-amber-400/40">Retry failed</button>
            </div>
            <ListingBatchTable
              rows={rows}
              selected={selected}
              onSelect={(id, yes) => setSelected((prev) => yes ? [...new Set([...prev, id])] : prev.filter((x) => x !== id))}
              onSelectAll={(yes) => setSelected(yes ? rows.map((r) => r.id) : [])}
              onOpenRow={setOpenRow}
            />
          </section>
        </>
      ) : null}

      <ListingRowDrawer
        row={openRow}
        columns={columns}
        busy={busy}
        onClose={() => setOpenRow(null)}
        onSave={(values) => run('Row saved.', async () => { const res = await updateListingRow(batch.id, openRow.id, { values }); setOpenRow(res.row); await loadBatch() })}
        onApprove={() => run('Row approved.', async () => { const res = await updateListingRow(batch.id, openRow.id, { values: openRow.current_values, status: 'Approved' }); setOpenRow(res.row); await loadBatch() })}
        onRegenerate={(only) => run('Row regenerated.', async () => { const res = await generateListingRow(batch.id, openRow.id, { only }); setOpenRow(res.row); await loadBatch() })}
      />
    </div>
  )
}
