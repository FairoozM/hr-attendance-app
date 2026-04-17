import { useRef, useState } from 'react'
import { Upload, Trash2, Download, Paperclip } from 'lucide-react'
import { useProjects } from '../../contexts/ProjectsContext'
import { formatFileSize, getFileIcon } from '../../utils/projectUtils'

export function AttachmentPanel({ task, projectId, onUpdate }) {
  const { uploadAttachment, deleteAttachment, getAttachmentDownloadUrl } = useProjects()
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const attachments = task.attachments || []

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')
    setUploading(true)
    try {
      await uploadAttachment(projectId, task.id, file)
      onUpdate?.()
    } catch (err) {
      setUploadError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDelete(attachment) {
    if (!window.confirm(`Delete "${attachment.file_name}"?`)) return
    try {
      await deleteAttachment(projectId, task.id, attachment.id)
      onUpdate?.()
    } catch (err) {
      setUploadError(err.message || 'Delete failed')
    }
  }

  async function handleDownload(attachment) {
    try {
      const result = await getAttachmentDownloadUrl(projectId, task.id, attachment.id)
      window.open(result.downloadUrl, '_blank')
    } catch (err) {
      setUploadError(err.message || 'Failed to get download link')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {attachments.length === 0 && !uploading && (
        <div style={{ fontSize: '0.78rem', color: 'var(--theme-text-dim)', padding: '0.25rem 0' }}>
          No attachments
        </div>
      )}

      {attachments.map((a) => (
        <div key={a.id} className="pm-attachment-item">
          <span className="pm-attachment-icon">{getFileIcon(a.file_type)}</span>
          <div className="pm-attachment-info">
            <div className="pm-attachment-name" title={a.file_name}>{a.file_name}</div>
            <div className="pm-attachment-meta">
              {a.file_size ? formatFileSize(a.file_size) : ''}
              {a.file_size && a.uploaded_at ? ' · ' : ''}
              {a.uploaded_at ? new Date(a.uploaded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
            </div>
          </div>
          <button className="pm-btn-icon pm-btn-sm" onClick={() => handleDownload(a)} title="Download">
            <Download size={12} />
          </button>
          <button className="pm-btn-icon pm-btn-sm" onClick={() => handleDelete(a)} title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      ))}

      {uploadError && (
        <div style={{ color: '#f87171', fontSize: '0.75rem' }}>{uploadError}</div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileChange}
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.zip,.txt"
      />
      <button
        className="pm-upload-btn"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <><span className="pm-spinner" style={{ width: 14, height: 14 }} /> Uploading…</>
        ) : (
          <><Paperclip size={13} /> Attach File</>
        )}
      </button>
    </div>
  )
}
