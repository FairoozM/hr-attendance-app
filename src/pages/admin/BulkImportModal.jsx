import { useCallback, useMemo, useRef, useState } from 'react'
import { Modal } from '../../components/Modal'

/**
 * Canonical CSV template for the bulk importer. Every row demonstrates a
 * real-world variation so admins have working examples to copy from:
 *   - row 2: full SKU + item_name, active=true (typical case)
 *   - row 3: SKU only, defaults to active (active column blank)
 *   - row 4: yes/no in the active column (alternate truthy syntax)
 *   - row 5: item_id-based mapping (no SKU)
 *   - row 6: name-only fallback (no SKU, no item_id) — works but discouraged
 *   - row 7: explicit deactivation (active=false)
 */
const SAMPLE_CSV =
  'report_group,sku,item_id,item_name,active,notes\n' +
  'slow_moving,FL-SHINE-001,,FL SHINE,true,seeded item\n' +
  'slow_moving,LIFEP2N-001,,LIFEP2N,,defaults to active when blank\n' +
  'other_family,LIFEP7S-001,,LIFEP7S,yes,yes/no also accepted\n' +
  'other_family,,89121200000123,LIFEP-ID-MAP,1,id-based mapping\n' +
  'other_family,,,LIFEP19,true,"name-only fallback (no SKU, discouraged)"\n' +
  'slow_moving,FL-OLD-001,,FL OLD,false,deactivate this mapping\n'

const STEP_PICK    = 'pick'
const STEP_PREVIEW = 'preview'
const STEP_CONFIRM = 'confirm'  // only for replace_group mode
const STEP_DONE    = 'done'

const MODE_UPSERT  = 'upsert'
const MODE_REPLACE = 'replace_group'

/**
 * RFC-4180 cell quoting:
 *   - empty / null / undefined → ""
 *   - cell containing comma, quote, CR or LF → wrap in quotes, escape "" → ""
 *   - everything else passes through untouched
 */
function csvCell(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function triggerDownload(text, filename) {
  // Prepend a UTF-8 BOM so Excel/Numbers open the file as UTF-8.
  const blob = new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function downloadSample() {
  triggerDownload(SAMPLE_CSV, 'item-report-groups-template.csv')
}

/**
 * Export only the rows whose planner status is `invalid`. Re-emits the
 * original input columns (so admins can correct in place and re-upload),
 * appends an `error_message` column joining all validation errors with " | ",
 * and prepends a `row_number` column matching the source CSV line so
 * fixes are easy to locate.
 */
function downloadInvalidRows(rows) {
  const invalid = (rows || []).filter((r) => r.action === 'invalid')
  if (invalid.length === 0) return
  const headers = [
    'row_number', 'report_group', 'sku', 'item_id',
    'item_name', 'active', 'notes', 'error_message',
  ]
  const lines = [headers.join(',')]
  for (const r of invalid) {
    const v = r.normalized || {}
    const activeOut = v.active === true ? 'true'
      : v.active === false ? 'false'
      : '' // leave blank when active was unparseable / omitted
    lines.push([
      r.row_number,
      v.report_group,
      v.sku,
      v.item_id,
      v.item_name,
      activeOut,
      v.notes,
      (r.errors || []).join(' | '),
    ].map(csvCell).join(','))
  }
  // Use a date-stamp so repeated downloads don't overwrite each other.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  triggerDownload(lines.join('\n') + '\n', `item-report-groups-failed-${stamp}.csv`)
}

function ActionPill({ action }) {
  const cls =
    action === 'create'  ? 'irg-pill irg-pill--active' :
    action === 'update'  ? 'irg-pill irg-pill--group'  :
    action === 'invalid' ? 'irg-pill irg-pill--inactive' :
    'irg-pill'
  return <span className={cls}>{action}</span>
}

/**
 * Turn a planned/committed row into a status pill + plain-text message.
 *
 * Status reflects the *outcome* — i.e. whether the row will be / was applied,
 * separate from the planned `Action` column which describes *what* will be /
 * was applied. Examples:
 *
 *   action=create, committed       → status="Created",     message="Created (id #73)"
 *   action=update, dry-run         → status="Will update", message="Matches existing #11 (was: …)"
 *   action=invalid                 → status="Invalid",     message="<error 1>; <error 2>"
 */
function rowStatus(row, mode) {
  if (row.action === 'invalid') {
    // For in-CSV duplicates we surface a tighter label so the banner counts
    // and the row pill agree at a glance (banner has a separate "Skipped"
    // tile for these). All other invalid rows render as plain "Invalid".
    if (row.duplicate_of_row != null) {
      return {
        label: 'Duplicate',
        tone: 'bad',
        message: (row.errors || [])[0] || 'Duplicate row',
        detail: row.duplicate_of_row ? `First occurrence at row ${row.duplicate_of_row}` : '',
      }
    }
    const message = (row.errors || []).join('; ') || 'Invalid row'
    return { label: 'Invalid', tone: 'bad', message }
  }
  const committed = mode === 'import' && Boolean(row.result_action)
  if (row.action === 'create') {
    return committed
      ? { label: 'Created', tone: 'good', message: `Created (id #${row.id})` }
      : { label: 'Will create', tone: 'good', message: 'Eligible to create' }
  }
  if (row.action === 'update') {
    const wasName = row.existing?.item_name
    const baseMsg = `Matches existing #${row.existing_id}${wasName ? ` (was: ${wasName})` : ''}`
    return committed
      ? { label: 'Updated', tone: 'info', message: `Updated id #${row.id}${wasName ? ` (was: ${wasName})` : ''}` }
      : { label: 'Will update', tone: 'info', message: baseMsg }
  }
  return { label: row.action || '—', tone: 'neutral', message: '—' }
}

function StatusPill({ tone, label }) {
  const cls =
    tone === 'good' ? 'irg-pill irg-pill--active' :
    tone === 'info' ? 'irg-pill irg-pill--group'  :
    tone === 'bad'  ? 'irg-pill irg-pill--inactive' :
    'irg-pill'
  return <span className={cls}>{label}</span>
}

/**
 * Color-coded banner that summarises the planner / commit result. Renders
 * the same counts in dry-run and import modes; only the labels change
 * (e.g. "Created" vs "Will create") so the banner reads naturally in both
 * contexts.
 *
 * Color tokens (see ItemReportGroupsAdminPage.css):
 *   - good  → green  (created / will create)
 *   - info  → blue   (updated / will update)
 *   - bad   → red    (invalid)
 *   - warn  → amber  (skipped — duplicates inside the same CSV)
 *   - neutral → gray (totals / mode)
 */
function PreviewSummary({ summary, mode }) {
  const committed = mode === 'import'
  // `skipped` is the planner's term for in-CSV duplicates that are de-duped
  // before commit. Surfaced under "Skipped" only when there's actually
  // something to report so the banner stays uncluttered.
  const skipped = summary.skipped ?? summary.duplicate_in_csv ?? 0

  const tiles = [
    {
      key:   'total',
      label: 'Total rows',
      value: summary.total_rows ?? 0,
      tone:  'neutral',
    },
    {
      key:   'created',
      label: committed ? 'Created' : 'Will create',
      value: summary.to_create ?? 0,
      tone:  'good',
    },
    {
      key:   'updated',
      label: committed ? 'Updated' : 'Will update',
      value: summary.to_update ?? 0,
      tone:  'info',
    },
    {
      key:   'invalid',
      label: 'Invalid',
      value: summary.invalid ?? 0,
      tone:  'bad',
    },
  ]
  if (skipped > 0) {
    tiles.push({
      key:   'skipped',
      label: 'Skipped',
      value: skipped,
      tone:  'warn',
      hint:  'Duplicate identifiers within the uploaded CSV',
    })
  }

  return (
    <div
      className="bulk-banner"
      role="status"
      aria-label={`Bulk import summary (${committed ? 'committed' : 'dry run'})`}
    >
      <div className="bulk-banner__mode">
        <span className="bulk-banner__mode-dot" data-mode={committed ? 'import' : 'dry'} />
        {committed ? 'Imported (committed)' : 'Dry run preview'}
      </div>
      <div className="bulk-banner__tiles">
        {tiles.map((t) => (
          <div
            key={t.key}
            className={`bulk-banner__tile bulk-banner__tile--${t.tone} ${t.value > 0 ? 'is-active' : 'is-zero'}`}
            title={t.hint || undefined}
          >
            <span className="bulk-banner__value">{t.value}</span>
            <span className="bulk-banner__label">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PreviewTable({ rows, mode }) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="bulk-table-wrap">
      <table className="bulk-table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Report Group</th>
            <th>SKU</th>
            <th>Item ID</th>
            <th>Item Name</th>
            <th>Action</th>
            <th>Status</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const status = rowStatus(r, mode)
            const isInvalid = r.action === 'invalid'
            return (
              <tr key={r.row_number} className={isInvalid ? 'bulk-row--invalid' : ''}>
                <td>{r.row_number}</td>
                <td>{r.normalized?.report_group || '—'}</td>
                <td className="irg-mono">{r.normalized?.sku || '—'}</td>
                <td className="irg-mono">{r.normalized?.item_id || '—'}</td>
                <td>{r.normalized?.item_name || '—'}</td>
                <td><ActionPill action={r.action} /></td>
                <td><StatusPill tone={status.tone} label={status.label} /></td>
                <td>
                  {isInvalid && !r.duplicate_of_row && r.errors?.length > 1 ? (
                    <ul className="bulk-errors">
                      {r.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  ) : (
                    <>
                      <span className={isInvalid ? 'bulk-msg bulk-msg--err' : 'bulk-msg'}>
                        {status.message}
                      </span>
                      {status.detail && (
                        <span className="bulk-msg bulk-msg--dim"> · {status.detail}</span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Surfaces the impact of `replace_group` mode on the dry-run preview.
 * Renders a per-group breakdown so the admin can see exactly how many active
 * rows currently exist in each affected group and how many of them are
 * being re-asserted by the CSV. Anything not re-asserted will remain
 * deactivated after the import.
 */
function ReplacePreviewBanner({ preview }) {
  if (!preview || !Array.isArray(preview.by_group) || preview.by_group.length === 0) {
    return (
      <div className="bulk-replace bulk-replace--warn" role="status">
        <strong>Replace group mode</strong>
        <p>
          The uploaded CSV does not contain any valid rows in known report
          groups, so nothing would be deactivated. Switch to Upsert mode or
          fix the rows above.
        </p>
      </div>
    )
  }
  return (
    <div className="bulk-replace" role="status">
      <div className="bulk-replace__head">
        <strong>Replace group impact</strong>
        <span className="bulk-replace__pill">
          {preview.currently_active_total} active row(s) currently in {preview.groups.length} group(s)
        </span>
      </div>
      <table className="bulk-replace__table">
        <thead>
          <tr>
            <th>Report group</th>
            <th>Currently active</th>
            <th>Re-asserted by CSV</th>
            <th>Will be deactivated (if not in CSV)</th>
          </tr>
        </thead>
        <tbody>
          {preview.by_group.map((g) => {
            const willGo = Math.max(g.currently_active - g.in_csv, 0)
            return (
              <tr key={g.report_group}>
                <td className="irg-mono">{g.report_group}</td>
                <td>{g.currently_active}</td>
                <td>{g.in_csv}</td>
                <td className={willGo > 0 ? 'bulk-replace__will-go' : ''}>{willGo}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="bulk-replace__note">
        On commit, every active row in the listed groups is deactivated first,
        then the CSV is upserted. Rows not present in the CSV stay deactivated.
      </p>
    </div>
  )
}

/**
 * Post-commit summary block for `replace_group` mode. Mirrors the structure
 * of the dry-run preview, replacing forecasted counts with what actually ran.
 */
function ReplaceResultBanner({ result }) {
  if (!result || result.deactivated_total == null) return null
  return (
    <div className="bulk-replace bulk-replace--good" role="status">
      <div className="bulk-replace__head">
        <strong>Replace group: applied</strong>
        <span className="bulk-replace__pill">
          {result.deactivated_total} row(s) deactivated across {result.groups.length} group(s)
        </span>
      </div>
      <ul className="bulk-replace__list">
        {result.by_group.map((g) => (
          <li key={g.report_group}>
            <code>{g.report_group}</code>: deactivated {g.deactivated} row(s) before applying CSV
          </li>
        ))}
      </ul>
    </div>
  )
}

function FormatHelp() {
  return (
    <details className="bulk-help">
      <summary>CSV format help</summary>
      <ul>
        <li><strong>Required column:</strong> <code>report_group</code> (lowercase letters/digits/_/-).</li>
        <li>
          At least one of <code>sku</code>, <code>item_id</code>, or{' '}
          <code>item_name</code> must be present per row. SKU is the preferred match key.
        </li>
        <li>
          <code>active</code> accepts <code>true/false</code>, <code>yes/no</code>, or{' '}
          <code>1/0</code>. Defaults to <code>true</code> if omitted.
        </li>
        <li><code>notes</code> is optional and free-form.</li>
        <li>
          Matching for upsert uses the priority{' '}
          <code>sku → item_id → item_name</code> within the same{' '}
          <code>report_group</code>.
        </li>
        <li>
          A <strong>Dry run</strong> validates without writing. The real{' '}
          <strong>Import</strong> is transactional — if any row would fail, the
          entire batch is rolled back and nothing changes.
        </li>
      </ul>
    </details>
  )
}

export function BulkImportModal({ open, onClose, onDryRun, onImport }) {
  const [step, setStep]       = useState(STEP_PICK)
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [mode, setMode]       = useState(MODE_UPSERT)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [plan, setPlan]       = useState(null)   // dry-run output (or 422 plan)
  const [committed, setCommitted] = useState(null)
  const fileInputRef = useRef(null)

  const reset = useCallback(() => {
    setStep(STEP_PICK)
    setCsvText('')
    setFileName('')
    setMode(MODE_UPSERT)
    setBusy(false)
    setError('')
    setPlan(null)
    setCommitted(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const close = useCallback(() => {
    if (busy) return
    reset()
    onClose()
  }, [busy, reset, onClose])

  const onFileChange = useCallback(async (e) => {
    setError('')
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    try {
      const text = await file.text()
      setCsvText(text)
    } catch (err) {
      setError(err.message || 'Failed to read file')
    }
  }, [])

  const runDryRun = useCallback(async () => {
    if (!csvText.trim()) {
      setError('Pick a CSV file first.')
      return
    }
    setBusy(true)
    setError('')
    setPlan(null)
    setCommitted(null)
    try {
      const result = await onDryRun(csvText, { mode })
      setPlan(result)
      setStep(STEP_PREVIEW)
    } catch (err) {
      // The backend returns the plan inside err.body for some 4xx (e.g. 422),
      // but plain parse errors don't have a plan — render the message inline.
      setError(err.message || 'Dry-run failed')
    } finally {
      setBusy(false)
    }
  }, [csvText, mode, onDryRun])

  const runImport = useCallback(async () => {
    if (!csvText.trim()) {
      setError('Pick a CSV file first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await onImport(csvText, { mode })
      setCommitted(result)
      setPlan(result)
      setStep(STEP_DONE)
    } catch (err) {
      if (err?.status === 422 && err?.body?.summary) {
        // Plan with invalid rows is included in the error body — re-render
        // it on the preview screen so the admin sees what to fix.
        setPlan(err.body)
        setStep(STEP_PREVIEW)
        setError(err.message || 'Import refused: fix the invalid rows below.')
      } else if (err?.status === 409) {
        setStep(STEP_PREVIEW)
        setError(
          err.body?.error ||
          'Bulk import failed due to a unique-constraint violation. The whole batch was rolled back.'
        )
      } else if (err?.status === 400 && err?.body?.code === 'REPLACE_GROUP_EMPTY_CSV') {
        setStep(STEP_PREVIEW)
        setError(err.body.error)
      } else {
        setStep(STEP_PREVIEW)
        setError(err.message || 'Import failed')
      }
    } finally {
      setBusy(false)
    }
  }, [csvText, mode, onImport])

  const canCommit = useMemo(
    () => Boolean(plan && plan.summary && plan.summary.invalid === 0 && plan.summary.total_rows > 0),
    [plan]
  )

  /**
   * Click handler for the green "Confirm Import" button on the preview
   * screen. For the safe Upsert mode we go straight to the API; for the
   * destructive Replace Group mode we route through the typed-confirm step.
   */
  const onConfirmImportClick = useCallback(() => {
    if (!canCommit) return
    if (mode === MODE_REPLACE) {
      setStep(STEP_CONFIRM)
    } else {
      runImport()
    }
  }, [canCommit, mode, runImport])

  // The typed-confirm step requires the admin to type the literal word
  // "REPLACE" — same trick the rest of the app uses for irreversible writes.
  const [confirmText, setConfirmText] = useState('')
  const confirmOk = confirmText.trim().toUpperCase() === 'REPLACE'

  return (
    <Modal
      title="Bulk Import — Item Report Groups"
      open={open}
      onClose={close}
      panelClassName="modal-panel--wide"
    >
      <div className="bulk-modal">
        {step === STEP_PICK && (
          <>
            <p className="bulk-intro">
              Upload a CSV to create or update many item ↔ report_group
              mappings at once. The import is <strong>upsert</strong>: existing
              rows are updated, missing rows are created. Use{' '}
              <strong>Dry run</strong> first to preview changes safely.
            </p>

            <div className="bulk-pick">
              <label className="bulk-pick__file">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFileChange}
                  disabled={busy}
                />
                <span>{fileName || 'Choose CSV file…'}</span>
              </label>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={downloadSample}
                disabled={busy}
              >
                Download CSV Template
              </button>
            </div>

            <fieldset className="bulk-mode" disabled={busy}>
              <legend>Import mode</legend>
              <label className="bulk-mode__opt">
                <input
                  type="radio"
                  name="bulk-mode"
                  value={MODE_UPSERT}
                  checked={mode === MODE_UPSERT}
                  onChange={() => setMode(MODE_UPSERT)}
                />
                <span>
                  <strong>Upsert</strong> — match-or-create per row. Existing
                  rows not in the CSV are left untouched.
                </span>
              </label>
              <label className="bulk-mode__opt">
                <input
                  type="radio"
                  name="bulk-mode"
                  value={MODE_REPLACE}
                  checked={mode === MODE_REPLACE}
                  onChange={() => setMode(MODE_REPLACE)}
                />
                <span>
                  <strong>Replace group</strong> — deactivate every active row
                  in each report_group present in the CSV, then upsert. Rows
                  not in the CSV stay deactivated.{' '}
                  <em className="bulk-mode__warn">Destructive — requires confirmation.</em>
                </span>
              </label>
            </fieldset>

            <FormatHelp />

            {csvText && (
              <details className="bulk-help">
                <summary>Preview ({csvText.split(/\r?\n/).length} lines)</summary>
                <pre className="bulk-preview-pre">
                  {csvText.length > 4000 ? `${csvText.slice(0, 4000)}\n…(${csvText.length - 4000} more chars)` : csvText}
                </pre>
              </details>
            )}

            {error && <p className="irg-form__err" role="alert">{error}</p>}

            <div className="irg-form__actions">
              <button type="button" className="btn btn--ghost" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={runDryRun}
                disabled={busy || !csvText.trim()}
                aria-busy={busy}
              >
                {busy ? 'Validating…' : 'Run Dry-Run'}
              </button>
            </div>
          </>
        )}

        {step === STEP_PREVIEW && plan && (
          <>
            <PreviewSummary summary={plan.summary} mode={plan.mode || 'dry_run'} />

            {plan.import_mode === MODE_REPLACE && plan.replace_preview && (
              <ReplacePreviewBanner preview={plan.replace_preview} />
            )}

            {plan.summary?.unknown_headers?.length > 0 && (
              <p className="bulk-warn">
                Unknown column(s) in CSV will be ignored:{' '}
                <strong>{plan.summary.unknown_headers.join(', ')}</strong>
              </p>
            )}

            {plan.summary.total_rows === 0 ? (
              <p className="bulk-empty">No data rows in the uploaded CSV.</p>
            ) : (
              <>
                {plan.summary.invalid > 0 && (
                  <div className="bulk-toolbar">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => downloadInvalidRows(plan.rows)}
                      title="Export the invalid rows (with their error messages) so you can fix and re-upload"
                    >
                      Download Failed Rows CSV ({plan.summary.invalid})
                    </button>
                  </div>
                )}
                <PreviewTable rows={plan.rows} mode={plan.mode || 'dry_run'} />
              </>
            )}

            {error && <p className="irg-form__err" role="alert">{error}</p>}

            {!canCommit && plan.summary.invalid > 0 && (
              <p className="bulk-warn">
                Fix the {plan.summary.invalid} invalid row(s) above and re-upload
                — the importer is all-or-nothing and will refuse a batch with
                any invalid rows.
              </p>
            )}

            <div className="irg-form__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => { setPlan(null); setStep(STEP_PICK); setError('') }}
                disabled={busy}
              >
                Back
              </button>
              <button
                type="button"
                className={`btn ${mode === MODE_REPLACE ? 'btn--danger' : 'btn--primary'}`}
                onClick={onConfirmImportClick}
                disabled={busy || !canCommit}
                aria-busy={busy}
                title={!canCommit ? 'Resolve invalid rows first' : undefined}
              >
                {busy
                  ? 'Importing…'
                  : mode === MODE_REPLACE
                  ? `Continue to Replace (${plan.summary.to_create + plan.summary.to_update} row${plan.summary.to_create + plan.summary.to_update === 1 ? '' : 's'})…`
                  : `Confirm Import (${plan.summary.to_create + plan.summary.to_update} row${plan.summary.to_create + plan.summary.to_update === 1 ? '' : 's'})`}
              </button>
            </div>
          </>
        )}

        {step === STEP_CONFIRM && plan && (
          <>
            <div className="bulk-replace bulk-replace--danger" role="alert">
              <strong>You're about to deactivate {plan.replace_preview?.currently_active_total ?? '?'} active row(s).</strong>
              <p>
                This will turn off every active row in{' '}
                <code>{(plan.replace_preview?.groups || []).join(', ')}</code>{' '}
                before applying the CSV. Rows missing from the CSV will stay
                deactivated. The whole operation runs in one transaction — if
                anything fails, nothing is changed.
              </p>
              {plan.replace_preview && <ReplacePreviewBanner preview={plan.replace_preview} />}
              <label className="bulk-replace__confirm">
                <span>
                  Type <code>REPLACE</code> to confirm:
                </span>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="REPLACE"
                  autoFocus
                  disabled={busy}
                />
              </label>
            </div>

            {error && <p className="irg-form__err" role="alert">{error}</p>}

            <div className="irg-form__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => { setConfirmText(''); setStep(STEP_PREVIEW); setError('') }}
                disabled={busy}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={runImport}
                disabled={busy || !confirmOk}
                aria-busy={busy}
                title={!confirmOk ? 'Type REPLACE to enable' : undefined}
              >
                {busy
                  ? 'Replacing…'
                  : `Yes — Deactivate & Apply (${plan.summary.to_create + plan.summary.to_update} row${plan.summary.to_create + plan.summary.to_update === 1 ? '' : 's'})`}
              </button>
            </div>
          </>
        )}

        {step === STEP_DONE && committed && (
          <>
            <div className="bulk-success" role="status">
              <strong>Import committed.</strong>
              <span>The whole batch was applied transactionally.</span>
            </div>
            <PreviewSummary summary={committed.summary} mode="import" />
            {committed.import_mode === MODE_REPLACE && committed.replace_result && (
              <ReplaceResultBanner result={committed.replace_result} />
            )}
            {committed.summary.invalid > 0 && (
              <div className="bulk-toolbar">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => downloadInvalidRows(committed.rows)}
                >
                  Download Failed Rows CSV ({committed.summary.invalid})
                </button>
              </div>
            )}
            <PreviewTable rows={committed.rows} mode="import" />
            <div className="irg-form__actions">
              <button type="button" className="btn btn--primary" onClick={close}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

export default BulkImportModal
