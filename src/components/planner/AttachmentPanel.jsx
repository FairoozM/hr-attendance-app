import { useRef, useState } from 'react'
import { useAIPlanner } from '../../contexts/AIPlannerContext'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
const MAX_FILE_MB = 5

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(type) {
  if (IMAGE_TYPES.includes(type)) return '🖼️'
  if (type === 'application/pdf') return '📄'
  if (type.includes('word') || type.includes('document')) return '📝'
  if (type.includes('sheet') || type.includes('excel') || type.includes('csv')) return '📊'
  if (type.includes('zip') || type.includes('rar') || type.includes('tar')) return '🗜️'
  return '📎'
}

function AttachmentItem({ taskId, attachment }) {
  const { deleteAttachment } = useAIPlanner()
  const [confirmDel, setConfirmDel] = useState(false)
  const isImage = IMAGE_TYPES.includes(attachment.type)

  function handleDownload() {
    const a = document.createElement('a')
    a.href = attachment.dataUrl
    a.download = attachment.name
    a.click()
  }

  return (
    <div className="aip-attach-item">
      {/* Thumbnail or icon */}
      {isImage ? (
        <div className="aip-attach-thumb" onClick={handleDownload} title="Click to download">
          <img src={attachment.dataUrl} alt={attachment.name} className="aip-attach-img" />
        </div>
      ) : (
        <div className="aip-attach-icon" onClick={handleDownload} title="Click to download">
          {fileIcon(attachment.type)}
        </div>
      )}

      {/* Info */}
      <div className="aip-attach-info">
        <span className="aip-attach-name" title={attachment.name}>{attachment.name}</span>
        <span className="aip-attach-meta">
          {formatSize(attachment.size)} · {new Date(attachment.uploadedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </span>
      </div>

      {/* Actions */}
      <div className="aip-attach-actions">
        <button className="aip-attach-btn" onClick={handleDownload} title="Download">
          ↓
        </button>
        {confirmDel ? (
          <>
            <button
              className="aip-attach-btn aip-attach-btn--danger"
              onClick={() => deleteAttachment(taskId, attachment.id)}
              title="Confirm delete"
            >
              ✓
            </button>
            <button className="aip-attach-btn" onClick={() => setConfirmDel(false)} title="Cancel">
              ✕
            </button>
          </>
        ) : (
          <button
            className="aip-attach-btn aip-attach-btn--soft-danger"
            onClick={() => setConfirmDel(true)}
            title="Delete attachment"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  )
}

export function AttachmentPanel({ taskId, attachments = [] }) {
  const { addAttachment } = useAIPlanner()
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)

  async function processFiles(files) {
    setError('')
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        setError(`"${file.name}" is too large (max ${MAX_FILE_MB} MB)`)
        continue
      }
      setUploading(true)
      try {
        await addAttachment(taskId, file)
      } catch {
        setError(`Failed to attach "${file.name}"`)
      } finally {
        setUploading(false)
      }
    }
  }

  function handleFileChange(e) {
    if (e.target.files?.length) {
      processFiles(e.target.files)
      e.target.value = ''
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files)
  }

  return (
    <div className="aip-attachments">
      {/* Header */}
      <div className="aip-attachments__head">
        <span className="aip-attachments__label">
          Attachments
          {attachments.length > 0 && (
            <span className="aip-subtasks__count">{attachments.length}</span>
          )}
        </span>
      </div>

      {/* File list */}
      {attachments.length > 0 && (
        <div className="aip-attach-list">
          {attachments.map((a) => (
            <AttachmentItem key={a.id} taskId={taskId} attachment={a} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="aip-attach-error">{error}</div>
      )}

      {/* Drop zone / upload trigger */}
      <div
        className={`aip-attach-drop ${dragOver ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
          accept="*/*"
        />
        {uploading ? (
          <span className="aip-spinner" style={{ width: '1rem', height: '1rem' }} />
        ) : (
          <>
            <span className="aip-attach-drop__icon">📎</span>
            <span className="aip-attach-drop__text">
              {dragOver ? 'Drop to attach' : 'Click or drag files here'}
            </span>
            <span className="aip-attach-drop__hint">Max {MAX_FILE_MB} MB per file</span>
          </>
        )}
      </div>
    </div>
  )
}
