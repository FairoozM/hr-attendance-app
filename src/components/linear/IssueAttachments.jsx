/**
 * IssueAttachments — "Files" tab inside IssueDetailPanel.
 *
 * Flow (presigned S3):
 *   1. Pick/drop file → validate type + size client-side
 *   2. POST .../attachments/upload-url → presigned PUT URL + s3Key
 *   3. PUT file to S3 directly (no backend involvement, no auth header)
 *   4. POST .../attachments → save metadata → gets row back
 *   5. GET .../attachments/:id/download-url → show thumbnail / open lightbox
 *
 * Activity logging happens server-side on save and delete.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Upload, FileText, X, Trash2, ExternalLink, Eye, AlertCircle, Loader2 } from 'lucide-react'
import {
  listAttachmentsApi,
  getAttachmentUploadUrlApi,
  saveAttachmentMetaApi,
  deleteAttachmentApi,
  getAttachmentDownloadUrlApi,
} from '../../lib/projectsApi'
import './IssueAttachments.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'application/pdf',
])
const MAX_SIZE_BYTES = 10 * 1024 * 1024  // 10 MB

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

function AttachmentCard({ att, signedUrl, onView, onOpen, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const img = isImage(att.file_type)

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

        {!confirmDelete ? (
          <button
            type="button"
            className="ia-card__btn ia-card__btn--delete"
            onClick={() => setConfirmDelete(true)}
            title="Delete attachment"
          >
            <Trash2 size={13} />
          </button>
        ) : (
          <span className="ia-card__confirm">
            <button type="button" className="ia-card__confirm-yes" onClick={() => onDelete(att)}>
              Delete
            </button>
            <button type="button" className="ia-card__confirm-no" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </span>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function IssueAttachments({ issue, project }) {
  const projectId = issue?.projectId || project?.id
  const taskId    = issue?.id

  // Local attachment list (starts from issue.attachments, then syncs from API)
  const [attachments, setAttachments] = useState([])
  const [signedUrls,  setSignedUrls]  = useState({}) // { [attachmentId]: signedUrl }

  // Upload state
  const [uploading,    setUploading]    = useState(false)
  const [uploadError,  setUploadError]  = useState('')
  const [uploadingName, setUploadingName] = useState('')

  // Delete state
  const [deleting, setDeleting] = useState(null) // attachmentId

  // Lightbox
  const [preview, setPreview] = useState(null) // { url, name }

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
    const arr = Array.from(files)
    if (!arr.length) return
    // Upload sequentially to avoid race conditions
    arr.reduce((p, f) => p.then(() => uploadFile(f)), Promise.resolve())
  }, [uploadFile])

  const handleInputChange = (e) => { handleFiles(e.target.files); e.target.value = '' }

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const handleDragOver  = (e) => { e.preventDefault(); setDragOver(true) }
  const handleDragLeave = ()  => setDragOver(false)
  const handleDrop      = (e) => {
    e.preventDefault()
    setDragOver(false)
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="ia">
      {/* Upload zone */}
      <div
        className={`ia__zone ${dragOver ? 'ia__zone--drag' : ''} ${uploading ? 'ia__zone--uploading' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && !uploading && inputRef.current?.click()}
        aria-label="Upload files"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf"
          multiple
          className="ia__input"
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
              Drop files or <strong>click to upload</strong>
            </span>
            <span className="ia__zone-hint">PNG, JPG, WEBP, GIF, PDF · Max 10 MB</span>
          </>
        )}
      </div>

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

      {/* Attachment grid */}
      {attachments.length > 0 ? (
        <div className="ia__grid">
          {attachments.map((att) => (
            <AttachmentCard
              key={att.id}
              att={att}
              signedUrl={signedUrls[att.id] || null}
              onView={handleView}
              onOpen={handleOpen}
              onDelete={deleting === att.id ? () => {} : handleDelete}
            />
          ))}
        </div>
      ) : (
        !uploading && (
          <p className="ia__empty">No attachments yet. Upload screenshots, PDFs, or evidence files.</p>
        )
      )}

      {/* Image lightbox */}
      {preview && (
        <ImageLightbox url={preview.url} name={preview.name} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}
