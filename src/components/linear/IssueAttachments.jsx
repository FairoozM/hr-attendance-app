/**
 * IssueAttachments — "Files" tab inside IssueDetailPanel.
 *
 * Flow (presigned S3):
 *   1. Pick/drop file → validate type + size client-side
 *   2. POST .../attachments/upload-url → presigned PUT URL + s3Key
 *   3. PUT file to S3 directly (no backend involvement, no auth header)
 *   4. POST .../attachments → save metadata (incl. kind) → gets row back
 *   5. GET .../attachments/:id/download-url → show thumbnail / open lightbox
 *
 * Activity logging happens server-side on save, delete, and kind change.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Upload, FileText, X, Trash2, ExternalLink, Eye,
  AlertCircle, Loader2, Sparkles, ChevronDown,
} from 'lucide-react'
import {
  listAttachmentsApi,
  getAttachmentUploadUrlApi,
  saveAttachmentMetaApi,
  patchAttachmentApi,
  deleteAttachmentApi,
  getAttachmentDownloadUrlApi,
} from '../../lib/projectsApi'
import { AttachmentAIAnalysis } from './AttachmentAIAnalysis'
import './IssueAttachments.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'application/pdf',
])
const MAX_SIZE_BYTES = 10 * 1024 * 1024  // 10 MB

// ── Kind metadata ─────────────────────────────────────────────────────────────

export const KIND_OPTIONS = [
  { value: 'attachment',       label: 'Attachment' },
  { value: 'bug_evidence',     label: 'Bug Evidence' },
  { value: 'before',           label: 'Before' },
  { value: 'after',            label: 'After' },
  { value: 'qa_proof',         label: 'QA Proof' },
  { value: 'design_reference', label: 'Design Reference' },
  { value: 'release_evidence', label: 'Release Evidence' },
]

const KIND_LABEL = Object.fromEntries(KIND_OPTIONS.map((o) => [o.value, o.label]))

// Group display order (group label → kind values it covers)
const GROUPS = [
  { id: 'bug_evidence',     label: 'Bug Evidence',      kinds: ['bug_evidence'] },
  { id: 'before_after',     label: 'Before / After',    kinds: ['before', 'after'] },
  { id: 'qa_proof',         label: 'QA Proof',          kinds: ['qa_proof'] },
  { id: 'design_reference', label: 'Design Reference',  kinds: ['design_reference'] },
  { id: 'release_evidence', label: 'Release Evidence',  kinds: ['release_evidence'] },
  { id: 'attachment',       label: 'Attachments',       kinds: ['attachment'] },
]

function groupAttachments(atts) {
  const result = []
  for (const g of GROUPS) {
    const items = atts.filter((a) => g.kinds.includes(a.kind || 'attachment'))
    if (items.length > 0) result.push({ ...g, items })
  }
  return result
}

// Kind badge color class
function kindClass(kind) {
  const map = {
    attachment:       '',
    before:           'ia-kind--before',
    after:            'ia-kind--after',
    bug_evidence:     'ia-kind--bug',
    qa_proof:         'ia-kind--qa',
    design_reference: 'ia-kind--design',
    release_evidence: 'ia-kind--release',
  }
  return map[kind] || ''
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024)             return `${bytes} B`
  if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function isImage(fileType) {
  return typeof fileType === 'string' && fileType.startsWith('image/')
}

function fmtDate(raw) {
  if (!raw) return ''
  try {
    return new Date(raw).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '' }
}

function validateFile(file) {
  if (!ALLOWED_TYPES.has(file.type)) {
    return `Unsupported file type "${file.type}". Allowed: PNG, JPG, WEBP, GIF, PDF.`
  }
  if (file.size > MAX_SIZE_BYTES) {
    return `File "${file.name}" is too large (${formatBytes(file.size)}). Max 10 MB.`
  }
  return null
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function ImageLightbox({ url, name, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="ia-lightbox" onClick={onClose} role="dialog" aria-label={name}>
      <button className="ia-lightbox__close" onClick={onClose} aria-label="Close preview">
        <X size={20} />
      </button>
      <img
        className="ia-lightbox__img"
        src={url}
        alt={name}
        onClick={(e) => e.stopPropagation()}
      />
      <p className="ia-lightbox__name" onClick={(e) => e.stopPropagation()}>{name}</p>
    </div>
  )
}

// ── Attachment card ───────────────────────────────────────────────────────────

function AttachmentCard({
  att,
  signedUrl,
  onView,
  onOpen,
  onDelete,
  onAnalyze,
  onKindChange,
  canManageAttachments = true,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [kindChanging, setKindChanging] = useState(false)
  const img = isImage(att.file_type)
  const isPdf = att.file_type === 'application/pdf'
  const currentKind = att.kind || 'attachment'

  const handleKindChange = async (e) => {
    const newKind = e.target.value
    if (newKind === currentKind) return
    setKindChanging(true)
    try {
      await onKindChange(att, newKind)
    } finally {
      setKindChanging(false)
    }
  }

  return (
    <div className="ia-card">
      {/* Thumbnail */}
      <div className="ia-card__thumb" onClick={img ? () => onView(att, signedUrl) : undefined}>
        {img && signedUrl ? (
          <img src={signedUrl} alt={att.file_name} className="ia-card__img" />
        ) : (
          <span className="ia-card__file-icon">
            <FileText size={28} strokeWidth={1.5} />
          </span>
        )}
      </div>

      {/* Info */}
      <div className="ia-card__info">
        <p className="ia-card__name" title={att.file_name}>{att.file_name}</p>
        <p className="ia-card__meta">
          {att.file_type?.split('/')[1]?.toUpperCase() || 'FILE'}
          {att.file_size ? ` · ${formatBytes(att.file_size)}` : ''}
          {att.uploaded_at ? ` · ${fmtDate(att.uploaded_at)}` : ''}
        </p>

        {/* Kind selector */}
        <div className="ia-card__kind-row">
          <span className={`ia-kind-badge ${kindClass(currentKind)}`}>
            {KIND_LABEL[currentKind] || 'Attachment'}
          </span>
          <div className="ia-card__kind-select-wrap">
            <select
              className="ia-card__kind-select"
              value={currentKind}
              onChange={handleKindChange}
              disabled={kindChanging || !canManageAttachments}
              aria-label="Change classification"
              title="Change classification"
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {kindChanging
              ? <Loader2 size={10} className="ia-card__kind-spin" />
              : <ChevronDown size={10} className="ia-card__kind-chevron" />
            }
          </div>
        </div>

        {/* AI Analyze button — images only */}
        {img && canManageAttachments && (
          <button
            type="button"
            className="ia-card__ai-btn"
            onClick={() => onAnalyze(att)}
            title="Analyze with AI"
          >
            <Sparkles size={11} />
            Analyze with AI
          </button>
        )}
        {/* Non-image AI notice */}
        {isPdf && (
          <span className="ia-card__ai-note">AI analysis not supported for PDFs yet.</span>
        )}
      </div>

      {/* Actions */}
      <div className="ia-card__actions">
        <button
          type="button"
          className="ia-card__btn ia-card__btn--view"
          onClick={() => img ? onView(att, signedUrl) : onOpen(att)}
          title={img ? 'Preview' : 'Open in new tab'}
        >
          {img ? <Eye size={13} /> : <ExternalLink size={13} />}
        </button>

        {canManageAttachments && !confirmDelete ? (
          <button
            type="button"
            className="ia-card__btn ia-card__btn--delete"
            onClick={() => setConfirmDelete(true)}
            title="Delete attachment"
          >
            <Trash2 size={13} />
          </button>
        ) : canManageAttachments ? (
          <span className="ia-card__confirm">
            <button type="button" className="ia-card__confirm-yes" onClick={() => onDelete(att)}>
              Delete
            </button>
            <button type="button" className="ia-card__confirm-no" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </span>
        ) : null}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function IssueAttachments({ issue, project, onAppendDescription, canManageAttachments = true }) {
  const projectId = issue?.projectId || project?.id
  const taskId    = issue?.id

  // Local attachment list (starts from issue.attachments, then syncs from API)
  const [attachments, setAttachments] = useState([])
  const [signedUrls,  setSignedUrls]  = useState({}) // { [attachmentId]: signedUrl }

  // Upload state
  const [uploading,    setUploading]    = useState(false)
  const [uploadError,  setUploadError]  = useState('')
  const [uploadingName, setUploadingName] = useState('')

  // Kind to apply on next upload
  const [pendingKind, setPendingKind] = useState('attachment')

  // Delete state
  const [deleting, setDeleting] = useState(null) // attachmentId

  // Lightbox
  const [preview, setPreview] = useState(null) // { url, name }

  // AI analysis — holds the attachment to analyze (or null)
  const [analyzingAttachment, setAnalyzingAttachment] = useState(null)

  // Drag-over state
  const [dragOver, setDragOver] = useState(false)

  const inputRef = useRef(null)

  // ── Load attachments ──────────────────────────────────────────────────────
  const loadAttachments = useCallback(async () => {
    if (!projectId || !taskId) return
    try {
      const rows = await listAttachmentsApi(projectId, taskId)
      if (Array.isArray(rows)) setAttachments(rows)
    } catch { /* silently keep existing list */ }
  }, [projectId, taskId])

  useEffect(() => {
    // Seed from issue.attachments, then fetch fresh from API
    if (Array.isArray(issue?.attachments)) setAttachments(issue.attachments)
    loadAttachments()
  }, [issue?.id])                // re-load when issue changes, not on every render

  // ── Load signed URLs for all current attachments ──────────────────────────
  const loadSignedUrls = useCallback(async (atts) => {
    if (!projectId || !taskId || !atts.length) return
    const newUrls = {}
    await Promise.allSettled(
      atts.map(async (att) => {
        try {
          const res = await getAttachmentDownloadUrlApi(projectId, taskId, att.id)
          if (res?.downloadUrl) newUrls[att.id] = res.downloadUrl
        } catch { /* skip */ }
      })
    )
    setSignedUrls((prev) => ({ ...prev, ...newUrls }))
  }, [projectId, taskId])

  useEffect(() => {
    if (attachments.length > 0) loadSignedUrls(attachments)
  }, [attachments.length])       // load URLs when attachment count changes

  // ── Upload ────────────────────────────────────────────────────────────────
  const uploadFile = useCallback(async (file) => {
    const err = validateFile(file)
    if (err) { setUploadError(err); return }

    setUploading(true)
    setUploadError('')
    setUploadingName(file.name)

    try {
      // 1. Get presigned PUT URL
      const { uploadUrl, s3Key } = await getAttachmentUploadUrlApi(projectId, taskId, {
        fileName:    file.name,
        contentType: file.type,
        fileSize:    file.size,
      })

      // 2. PUT file to S3 (direct, no backend auth)
      const putRes = await fetch(uploadUrl, {
        method:  'PUT',
        body:    file,
        headers: { 'Content-Type': file.type },
      })
      if (!putRes.ok) throw new Error(`S3 upload failed (${putRes.status})`)

      // 3. Save metadata
      const att = await saveAttachmentMetaApi(projectId, taskId, {
        s3Key,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        kind: pendingKind,
      })

      // 4. Update list + fetch signed URL for new attachment
      setAttachments((prev) => [...prev, att])
      try {
        const res = await getAttachmentDownloadUrlApi(projectId, taskId, att.id)
        if (res?.downloadUrl) {
          setSignedUrls((prev) => ({ ...prev, [att.id]: res.downloadUrl }))
        }
      } catch { /* non-fatal */ }
    } catch (err) {
      setUploadError(err.message || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
      setUploadingName('')
    }
  }, [projectId, taskId])

  const handleFiles = useCallback((files) => {
    if (!canManageAttachments) return
    const arr = Array.from(files)
    if (!arr.length) return
    // Upload sequentially to avoid race conditions
    arr.reduce((p, f) => p.then(() => uploadFile(f)), Promise.resolve())
  }, [canManageAttachments, uploadFile])

  const handleInputChange = (e) => { handleFiles(e.target.files); e.target.value = '' }

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const handleDragOver  = (e) => { e.preventDefault(); setDragOver(true) }
  const handleDragLeave = ()  => setDragOver(false)
  const handleDrop      = (e) => {
    e.preventDefault()
    setDragOver(false)
    if (!canManageAttachments) return
    handleFiles(e.dataTransfer.files)
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (att) => {
    setDeleting(att.id)
    try {
      await deleteAttachmentApi(projectId, taskId, att.id)
      setAttachments((prev) => prev.filter((a) => a.id !== att.id))
      setSignedUrls((prev) => { const n = { ...prev }; delete n[att.id]; return n })
    } catch (err) {
      setUploadError(err.message || 'Failed to delete attachment.')
    } finally {
      setDeleting(null)
    }
  }, [projectId, taskId])

  // ── View / open ───────────────────────────────────────────────────────────
  const handleView = useCallback((att, url) => {
    if (url) setPreview({ url, name: att.file_name })
  }, [])

  const handleOpen = useCallback(async (att) => {
    const cached = signedUrls[att.id]
    if (cached) { window.open(cached, '_blank', 'noopener'); return }
    try {
      const res = await getAttachmentDownloadUrlApi(projectId, taskId, att.id)
      if (res?.downloadUrl) window.open(res.downloadUrl, '_blank', 'noopener')
    } catch (err) {
      setUploadError(err.message || 'Could not open file.')
    }
  }, [projectId, taskId, signedUrls])

  // ── Kind change ───────────────────────────────────────────────────────────
  const handleKindChange = useCallback(async (att, newKind) => {
    try {
      const updated = await patchAttachmentApi(projectId, taskId, att.id, { kind: newKind })
      setAttachments((prev) =>
        prev.map((a) => (a.id === att.id ? { ...a, kind: updated.kind || newKind } : a))
      )
    } catch (err) {
      setUploadError(err.message || 'Could not update classification.')
    }
  }, [projectId, taskId])

  // ── Render ────────────────────────────────────────────────────────────────
  const grouped = groupAttachments(attachments)

  return (
    <div className="ia">
      {/* Upload zone */}
      <div
        className={`ia__zone ${dragOver ? 'ia__zone--drag' : ''} ${uploading ? 'ia__zone--uploading' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !uploading && canManageAttachments && inputRef.current?.click()}
        role="button"
        tabIndex={canManageAttachments ? 0 : -1}
        onKeyDown={(e) => e.key === 'Enter' && !uploading && canManageAttachments && inputRef.current?.click()}
        aria-label="Upload files"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf"
          multiple
          className="ia__input"
          disabled={!canManageAttachments}
          onChange={handleInputChange}
        />
        {uploading ? (
          <>
            <Loader2 size={20} className="ia__zone-spin" aria-hidden="true" />
            <span className="ia__zone-label">Uploading {uploadingName}…</span>
          </>
        ) : (
          <>
            <Upload size={18} aria-hidden="true" />
            <span className="ia__zone-label">
              {canManageAttachments ? (
                <>
                  Drop files or <strong>click to upload</strong>
                </>
              ) : (
                'Attachments are read-only for your role.'
              )}
            </span>
            <span className="ia__zone-hint">PNG, JPG, WEBP, GIF, PDF · Max 10 MB</span>
          </>
        )}
      </div>

      {/* Upload kind selector */}
      {!uploading && canManageAttachments && (
        <div className="ia__upload-kind-row" onClick={(e) => e.stopPropagation()}>
          <span className="ia__upload-kind-label">Upload as:</span>
          <div className="ia__upload-kind-wrap">
            <select
              className="ia__upload-kind-select"
              value={pendingKind}
              onChange={(e) => setPendingKind(e.target.value)}
              aria-label="Upload classification"
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown size={11} className="ia__upload-kind-chevron" />
          </div>
        </div>
      )}

      {/* Error */}
      {uploadError && (
        <div className="ia__error" role="alert">
          <AlertCircle size={13} />
          {uploadError}
          <button type="button" className="ia__error-close" onClick={() => setUploadError('')}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Grouped attachment sections */}
      {grouped.length > 0 ? (
        <div className="ia__groups">
          {grouped.map((g) => (
            <div key={g.id} className="ia__group">
              <div className="ia__group-header">
                <span className={`ia-kind-badge ${kindClass(g.kinds[0])}`}>{g.label}</span>
                <span className="ia__group-count">{g.items.length}</span>
              </div>
              <div className="ia__grid">
                {g.items.map((att) => (
                  <AttachmentCard
                    key={att.id}
                    att={att}
                    signedUrl={signedUrls[att.id] || null}
                    onView={handleView}
                    onOpen={handleOpen}
                    onDelete={deleting === att.id ? () => {} : handleDelete}
                    onAnalyze={setAnalyzingAttachment}
                    onKindChange={handleKindChange}
                    canManageAttachments={canManageAttachments}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !uploading && (
          <p className="ia__empty">No attachments yet. Upload screenshots, PDFs, or evidence files.</p>
        )
      )}

      {/* AI Analysis panel — shown inline below the groups */}
      {analyzingAttachment && projectId && taskId && (
        <AttachmentAIAnalysis
          projectId={projectId}
          taskId={taskId}
          attachmentId={analyzingAttachment.id}
          fileName={analyzingAttachment.file_name}
          onClose={() => setAnalyzingAttachment(null)}
          onAppendDescription={onAppendDescription || (() => {})}
          onClassify={(newKind) => handleKindChange(analyzingAttachment, newKind)}
        />
      )}

      {/* Image lightbox */}
      {preview && (
        <ImageLightbox url={preview.url} name={preview.name} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}
