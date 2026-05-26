import { useMemo, useState } from 'react'
import {
  Archive, BookOpen, CheckCircle2, ClipboardList, Download,
  FolderDown, History, Loader2, RefreshCcw, Rocket, Server, ShieldAlert,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import LinearAccessDenied from '../../components/linear/LinearAccessDenied'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import {
  applyLinearWorkspaceImportApi,
  exportLinearWorkspaceApi,
  previewLinearWorkspaceImportApi,
  validateLinearWorkspaceExportApi,
} from '../../lib/linearWorkspaceApi'
import { canExportWorkspace } from '../../lib/linearPermissions'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import './LinearAdminBackupPage.css'

const PREF_KEY = 'linear.adminBackup.lastExportTimestamps'

const EXPORT_SCOPES = [
  {
    scope: 'all',
    title: 'Full Workspace Export',
    description: 'Issues, comments, activity, attachment metadata, docs, intake, releases, deployments, checklist runs, and audit.',
    Icon: Archive,
  },
  {
    scope: 'issues',
    title: 'Issues Export',
    description: 'Export issues, comments, activity, and attachment metadata only.',
    Icon: FolderDown,
  },
  {
    scope: 'docs',
    title: 'Docs Export',
    description: 'Export product docs and knowledge base content.',
    Icon: BookOpen,
  },
  {
    scope: 'intake',
    title: 'Intake Export',
    description: 'Export shared intake items and linked issue references.',
    Icon: ClipboardList,
  },
  {
    scope: 'releases',
    title: 'Releases Export',
    description: 'Export mobile release tracker records.',
    Icon: Rocket,
  },
  {
    scope: 'deployments',
    title: 'Deployments Export',
    description: 'Export website and backend deployment records.',
    Icon: Server,
  },
  {
    scope: 'checklists',
    title: 'Checklist Runs Export',
    description: 'Export SOP checklist run state for issue and release workflows.',
    Icon: CheckCircle2,
  },
  {
    scope: 'audit',
    title: 'Audit Export',
    description: 'Export recent audit rows. Latest 1000 rows by default.',
    Icon: History,
  },
]

const RESTORE_SCOPES = [
  { key: 'docs', label: 'Docs' },
  { key: 'intake', label: 'Intake' },
  { key: 'mobileReleases', label: 'Mobile Releases' },
  { key: 'deployments', label: 'Deployments' },
  { key: 'checklistRuns', label: 'Checklist Runs' },
]

function formatTimestamp(value) {
  if (!value) return 'Not exported yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })
}

function buildFilename(scope, exportedAt) {
  const date = new Date(exportedAt || Date.now())
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + '-' + pad(date.getHours()) + pad(date.getMinutes())
  return `lifesmile-linear-${scope}-${stamp}.json`
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export default function LinearAdminBackupPage() {
  const { user } = useAuth()
  const { getPref, setPref } = useUserPreferences()
  const lastExports = getPref(PREF_KEY, {}) || {}
  const [exportingScope, setExportingScope] = useState('')
  const [message, setMessage] = useState(null)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [selectedPayload, setSelectedPayload] = useState(null)
  const [validating, setValidating] = useState(false)
  const [validation, setValidation] = useState(null)
  const [validationError, setValidationError] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [selectedScopes, setSelectedScopes] = useState({
    docs: false,
    intake: false,
    mobileReleases: false,
    deployments: false,
    checklistRuns: false,
  })
  const [mode, setMode] = useState('append_only')
  const [conflictStrategy, setConflictStrategy] = useState('skip')
  const [confirmationText, setConfirmationText] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState(null)
  const [applyError, setApplyError] = useState('')

  const cards = useMemo(() => EXPORT_SCOPES.map((card) => ({
    ...card,
    lastExportedAt: lastExports?.[card.scope] || null,
  })), [lastExports])

  const selectedScopeKeys = useMemo(
    () => RESTORE_SCOPES.filter((item) => selectedScopes[item.key]).map((item) => item.key),
    [selectedScopes]
  )

  const canApply = !!preview && selectedScopeKeys.length > 0 && confirmationText === 'CONFIRM_IMPORT' && !applying

  if (!canExportWorkspace(user)) {
    return (
      <LinearAccessDenied
        title="Access Denied"
        message="You do not have permission to access workspace backup and restore tools."
      />
    )
  }

  const handleExport = async (scope) => {
    setExportingScope(scope)
    setMessage(null)
    try {
      const payload = await exportLinearWorkspaceApi(scope)
      const filename = buildFilename(scope, payload?.exportedAt)
      downloadJson(filename, payload)
      setPref(PREF_KEY, { ...lastExports, [scope]: payload?.exportedAt || new Date().toISOString() })
      setMessage({ type: 'success', text: `${scope} export downloaded.` })
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Export failed.' })
    } finally {
      setExportingScope('')
    }
  }

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    setValidation(null)
    setValidationError('')
    setSelectedPayload(null)
    setSelectedFileName(file?.name || '')
    setPreview(null)
    setPreviewError('')
    setApplyResult(null)
    setApplyError('')
    setConfirmationText('')
    setSelectedScopes({
      docs: false,
      intake: false,
      mobileReleases: false,
      deployments: false,
      checklistRuns: false,
    })
    if (!file) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      setSelectedPayload(parsed)
    } catch {
      setValidationError('Invalid JSON file. Select a valid Linear workspace export.')
    }
  }

  const handleValidate = async () => {
    if (!selectedPayload) {
      setValidationError('Choose a valid export JSON file first.')
      return
    }
    setValidating(true)
    setValidation(null)
    setValidationError('')
    try {
      const result = await validateLinearWorkspaceExportApi(selectedPayload)
      setValidation(result)
    } catch (err) {
      setValidationError(err.message || 'Validation failed.')
    } finally {
      setValidating(false)
    }
  }

  const handlePreview = async () => {
    if (!selectedPayload) {
      setPreviewError('Choose a valid export JSON file first.')
      return
    }
    setPreviewing(true)
    setPreview(null)
    setPreviewError('')
    setApplyResult(null)
    setApplyError('')
    try {
      const result = await previewLinearWorkspaceImportApi(selectedPayload)
      setPreview(result)
      setSelectedScopes({
        docs: (result?.counts?.docs?.incoming || 0) > 0,
        intake: (result?.counts?.intake?.incoming || 0) > 0,
        mobileReleases: (result?.counts?.mobileReleases?.incoming || 0) > 0,
        deployments: (result?.counts?.deployments?.incoming || 0) > 0,
        checklistRuns: (result?.counts?.checklistRuns?.incoming || 0) > 0,
      })
    } catch (err) {
      setPreviewError(err.message || 'Preview failed.')
    } finally {
      setPreviewing(false)
    }
  }

  const handleScopeToggle = (scopeKey) => {
    setSelectedScopes((current) => ({ ...current, [scopeKey]: !current[scopeKey] }))
  }

  const handleApply = async () => {
    if (!selectedPayload || !preview || !canApply) return
    setApplying(true)
    setApplyResult(null)
    setApplyError('')
    try {
      const result = await applyLinearWorkspaceImportApi({
        exportData: selectedPayload,
        previewToken: preview.previewToken,
        confirmation: confirmationText,
        options: {
          scopes: selectedScopeKeys,
          mode,
          conflictStrategy: mode === 'upsert' ? conflictStrategy : 'skip',
          includeAudit: false,
        },
      })
      setApplyResult(result)
      setMessage({ type: 'success', text: 'Import applied successfully.' })
    } catch (err) {
      setApplyError(err.message || 'Import failed.')
    } finally {
      setApplying(false)
    }
  }

  const renderCountRows = (counts) => (
    <ul>
      {RESTORE_SCOPES.map(({ key, label }) => {
        const row = counts?.[key] || {}
        return (
          <li key={key}>
            <strong>{label}:</strong>{' '}
            {`incoming ${row.incoming || 0}, create ${row.create || 0}, update ${row.update || 0}, skip ${row.skip || 0}, conflict ${row.conflict || 0}`}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="lab-page">
      <LinearSidebar />

      <main className="lab-main">
        <header className="lab-header">
          <div className="lab-header__icon">
            <Archive size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="lab-title">Backup &amp; Export</h1>
            <p className="lab-subtitle">Download product workspace data before migrations or major changes.</p>
          </div>
        </header>

        {message && (
          <div className={`lab-banner lab-banner--${message.type}`} role="status">
            {message.text}
          </div>
        )}

        <section className="lab-grid">
          {cards.map(({ scope, title, description, Icon, lastExportedAt }) => (
            <article key={scope} className="lab-card">
              <div className="lab-card__top">
                <span className="lab-card__icon"><Icon size={16} aria-hidden="true" /></span>
                <div>
                  <h2>{title}</h2>
                  <p>{description}</p>
                </div>
              </div>
              <p className="lab-card__meta">Last exported: {formatTimestamp(lastExportedAt)}</p>
              <button
                type="button"
                className="lab-card__button"
                onClick={() => handleExport(scope)}
                disabled={exportingScope === scope}
              >
                {exportingScope === scope ? <Loader2 size={14} className="lab-spin" /> : <Download size={14} />}
                Export JSON
              </button>
            </article>
          ))}
        </section>

        <section className="lab-validate">
          <div className="lab-validate__header">
            <RefreshCcw size={18} aria-hidden="true" />
            <div>
              <h2>Safe Restore / Import</h2>
              <p>Preview changes first, then apply append-only or explicit upsert.</p>
            </div>
          </div>

          <div className="lab-banner lab-banner--warning">
            Restore does not delete existing data. Restore does not include binary attachment files. Append-only is safest. Upsert can update existing shared records.
          </div>

          <div className="lab-validate__actions">
            <input type="file" accept="application/json,.json" onChange={handleFileChange} />
            <button type="button" className="lab-card__button" onClick={handlePreview} disabled={previewing || !selectedPayload}>
              {previewing ? <Loader2 size={14} className="lab-spin" /> : <RefreshCcw size={14} />}
              Preview Import
            </button>
            <button type="button" className="lab-card__button lab-card__button--ghost" onClick={handleValidate} disabled={validating || !selectedPayload}>
              {validating ? <Loader2 size={14} className="lab-spin" /> : <CheckCircle2 size={14} />}
              Validate Export File
            </button>
          </div>

          {selectedFileName && <p className="lab-validate__file">Selected file: {selectedFileName}</p>}
          {validationError && <div className="lab-banner lab-banner--error">{validationError}</div>}
          {previewError && <div className="lab-banner lab-banner--error">{previewError}</div>}
          {applyError && <div className="lab-banner lab-banner--error">{applyError}</div>}

          {preview && (
            <div className="lab-restore">
              <div className="lab-result__block">
                <h3>Preview Counts</h3>
                {renderCountRows(preview.counts)}
              </div>

              <div className="lab-restore__controls">
                <div className="lab-result__block">
                  <h3>Choose Scopes</h3>
                  <div className="lab-choice-list">
                    {RESTORE_SCOPES.map(({ key, label }) => (
                      <label key={key} className="lab-choice">
                        <input
                          type="checkbox"
                          checked={!!selectedScopes[key]}
                          onChange={() => handleScopeToggle(key)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="lab-result__block">
                  <h3>Choose Mode</h3>
                  <div className="lab-choice-list">
                    <label className="lab-choice">
                      <input type="radio" name="import-mode" checked={mode === 'append_only'} onChange={() => setMode('append_only')} />
                      <span>Append only recommended</span>
                    </label>
                    <label className="lab-choice">
                      <input type="radio" name="import-mode" checked={mode === 'upsert'} onChange={() => setMode('upsert')} />
                      <span>Upsert advanced</span>
                    </label>
                  </div>

                  {mode === 'upsert' && (
                    <div className="lab-choice-subgroup">
                      <h4>Conflict Strategy</h4>
                      <label className="lab-choice">
                        <input type="radio" name="conflict-strategy" checked={conflictStrategy === 'skip'} onChange={() => setConflictStrategy('skip')} />
                        <span>Skip conflicting existing records</span>
                      </label>
                      <label className="lab-choice">
                        <input type="radio" name="conflict-strategy" checked={conflictStrategy === 'update_existing'} onChange={() => setConflictStrategy('update_existing')} />
                        <span>Update existing records from previewed export</span>
                      </label>
                    </div>
                  )}
                </div>

                <div className="lab-result__block">
                  <h3>Confirm Import</h3>
                  <p>Type <strong>CONFIRM_IMPORT</strong> to enable apply.</p>
                  <input
                    type="text"
                    className="lab-input"
                    value={confirmationText}
                    onChange={(event) => setConfirmationText(event.target.value)}
                    placeholder="CONFIRM_IMPORT"
                  />
                  <button type="button" className="lab-card__button lab-apply-button" onClick={handleApply} disabled={!canApply}>
                    {applying ? <Loader2 size={14} className="lab-spin" /> : <CheckCircle2 size={14} />}
                    Apply Import
                  </button>
                </div>
              </div>

              <div className="lab-result">
                <div className="lab-result__block">
                  <h3>Warnings</h3>
                  {(preview.warnings || []).length > 0 ? (
                    <ul>
                      {(preview.warnings || []).map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  ) : (
                    <p>No warnings.</p>
                  )}
                </div>

                <div className="lab-result__block">
                  <h3>Conflicts</h3>
                  {(preview.conflicts || []).length > 0 ? (
                    <ul>
                      {(preview.conflicts || []).map((conflict, index) => (
                        <li key={`${conflict.scope}-${conflict.id}-${index}`}>
                          <strong>{conflict.scope}</strong>: {conflict.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No conflicts detected.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {validation && (
            <div className="lab-result">
              <div className="lab-result__row">
                <strong>Version:</strong> {validation.version || 'Missing'}
              </div>
              <div className="lab-result__row">
                <strong>Status:</strong> {validation.validVersion ? 'Valid export version' : 'Invalid or unsupported version'}
              </div>
              <div className="lab-result__row">
                <strong>Validation:</strong> This checks the file only and does not apply data
              </div>

              <div className="lab-result__block">
                <h3>Counts</h3>
                <ul>
                  {Object.entries(validation.counts || {}).map(([key, value]) => (
                    <li key={key}><strong>{key}:</strong> {value}</li>
                  ))}
                </ul>
              </div>

              <div className="lab-result__block">
                <h3>Possible Conflicts</h3>
                <ul>
                  {Object.entries(validation.possibleConflicts || {}).map(([key, value]) => (
                    <li key={key}>
                      <strong>{key}:</strong> {value?.count || 0}
                      {Array.isArray(value?.ids) && value.ids.length > 0 ? ` (sample ids: ${value.ids.join(', ')})` : ''}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="lab-result__block">
                <h3>Missing References</h3>
                {Array.isArray(validation.missingReferences) && validation.missingReferences.length > 0 ? (
                  <ul>
                    {validation.missingReferences.map((item, index) => (
                      <li key={`${item.entity}-${item.id}-${index}`}>
                        <strong>{item.entity}</strong> #{item.id}: missing `{item.field}` → {item.missing}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No missing references found.</p>
                )}
              </div>

              <div className="lab-result__block">
                <h3>Unsupported Fields</h3>
                {Object.keys(validation.unsupportedFields || {}).length > 0 ? (
                  <ul>
                    {Object.entries(validation.unsupportedFields || {}).map(([key, fields]) => (
                      <li key={key}><strong>{key}:</strong> {fields.join(', ')}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No unsupported fields detected.</p>
                )}
              </div>

              <div className="lab-result__block">
                <h3>Warnings</h3>
                <ul>
                  {(validation.warnings || []).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            </div>
          )}

          {applyResult && (
            <div className="lab-result">
              <div className="lab-result__row">
                <strong>Imported At:</strong> {formatTimestamp(applyResult.importedAt)}
              </div>
              <div className="lab-result__row">
                <strong>Mode:</strong> {applyResult.mode}
              </div>
              <div className="lab-result__row">
                <strong>Conflict Strategy:</strong> {applyResult.conflictStrategy}
              </div>
              <div className="lab-result__block">
                <h3>Applied Counts</h3>
                {renderCountRows(applyResult.counts)}
              </div>
              <div className="lab-result__block">
                <h3>Apply Warnings</h3>
                {(applyResult.warnings || []).length > 0 ? (
                  <ul>
                    {(applyResult.warnings || []).map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                ) : (
                  <p>No warnings.</p>
                )}
              </div>
              <div className="lab-result__block">
                <h3>Apply Conflicts</h3>
                {(applyResult.conflicts || []).length > 0 ? (
                  <ul>
                    {(applyResult.conflicts || []).map((conflict, index) => (
                      <li key={`${conflict.scope}-${conflict.id}-${index}`}>
                        <strong>{conflict.scope}</strong>: {conflict.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No conflicts.</p>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="lab-warnings">
          <div className="lab-warnings__header">
            <ShieldAlert size={18} aria-hidden="true" />
            <h2>Safety Notes</h2>
          </div>
          <ul>
            <li>Export does not include binary attachment files.</li>
            <li>Export does not include secrets, API keys, tokens, passwords, or S3 credentials.</li>
            <li>Attachment export includes metadata only.</li>
            <li>Store exported files securely.</li>
            <li>Restore only creates new records or explicitly updates existing records. It never deletes workspace data.</li>
          </ul>
        </section>
      </main>
    </div>
  )
}
