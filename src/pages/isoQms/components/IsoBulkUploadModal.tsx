import { useCallback, useMemo, useRef, useState } from 'react'
import { Modal } from '../../../components/Modal'
import {
  confirmIsoBulkUpload,
  confirmIsoUpload,
  presignIsoUpload,
  putFileToPresignedUrl,
} from '../../../api/isoQms'
import { parseFilenameSuggestions } from '../utils/filenameSuggest'
import { formatFileSize } from '../utils/isoFormat'
import type { IsoConfirmUploadPayload } from '../types'

const ALLOWED_EXT = /\.(pdf|docx?|xlsx?|csv|txt|jpe?g|png)$/i
const MAX_BYTES = 50 * 1024 * 1024

type UploadStatus = 'pending' | 'uploading' | 'ready' | 'confirming' | 'done' | 'error' | 'cancelled'

interface BulkRow {
  id: string
  file: File
  title: string
  documentCode: string
  documentType: string
  department: string
  confidentiality: string
  status: UploadStatus
  progress: number
  error?: string
  storageKey?: string
  checksumSha256?: string
}

interface IsoBulkUploadModalProps {
  open: boolean
  onClose: () => void
  onCompleted?: () => void
  defaultDepartment?: string
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function makeRow(file: File, department: string): BulkRow {
  const suggestion = parseFilenameSuggestions(file.name)
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    file,
    title: suggestion.title,
    documentCode: suggestion.documentCode || '',
    documentType: suggestion.documentType || 'Other Evidence',
    department,
    confidentiality: 'internal',
    status: 'pending',
    progress: 0,
  }
}

export function IsoBulkUploadModal({
  open,
  onClose,
  onCompleted,
  defaultDepartment = '',
}: IsoBulkUploadModalProps) {
  const [rows, setRows] = useState<BulkRow[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [massDept, setMassDept] = useState(defaultDepartment)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState('')
  const abortRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setRows([])
    setBanner('')
    setBusy(false)
    abortRef.current = false
  }, [])

  const handleClose = () => {
    abortRef.current = true
    reset()
    onClose()
  }

  const addFiles = (fileList: FileList | File[]) => {
    const next: BulkRow[] = []
    const errors: string[] = []
    for (const file of Array.from(fileList)) {
      if (!ALLOWED_EXT.test(file.name)) {
        errors.push(`${file.name}: unsupported type`)
        continue
      }
      if (file.size > MAX_BYTES) {
        errors.push(`${file.name}: exceeds 50 MB`)
        continue
      }
      next.push(makeRow(file, massDept))
    }
    if (errors.length) setBanner(errors.slice(0, 3).join('; '))
    setRows((prev) => [...prev, ...next])
  }

  const updateRow = (id: string, patch: Partial<BulkRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const cancelRow = (id: string) => {
    updateRow(id, { status: 'cancelled', progress: 0, error: 'Cancelled' })
  }

  const applyMassDepartment = () => {
    setRows((prev) =>
      prev.map((r) =>
        r.status === 'pending' || r.status === 'ready' || r.status === 'error'
          ? { ...r, department: massDept }
          : r
      )
    )
  }

  const uploadOne = async (row: BulkRow): Promise<BulkRow> => {
    if (abortRef.current || row.status === 'cancelled') {
      return { ...row, status: 'cancelled' }
    }
    updateRow(row.id, { status: 'uploading', progress: 5, error: undefined })
    try {
      const checksumSha256 = await sha256Hex(row.file)
      updateRow(row.id, { progress: 20, checksumSha256 })
      const presign = await presignIsoUpload({
        filename: row.file.name,
        contentType: row.file.type || 'application/octet-stream',
        fileSize: row.file.size,
      })
      updateRow(row.id, { progress: 40, storageKey: presign.storageKey })
      await putFileToPresignedUrl(presign.uploadUrl, row.file, presign.headers)
      const ready: BulkRow = {
        ...row,
        status: 'ready',
        progress: 100,
        storageKey: presign.storageKey,
        checksumSha256,
      }
      updateRow(row.id, ready)
      return ready
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      updateRow(row.id, { status: 'error', error: message, progress: 0 })
      return { ...row, status: 'error', error: message }
    }
  }

  const retryRow = async (id: string) => {
    const row = rows.find((r) => r.id === id)
    if (!row) return
    await uploadOne({ ...row, status: 'pending', error: undefined })
  }

  const uploadAllPending = async () => {
    setBusy(true)
    setBanner('')
    abortRef.current = false
    const pending = rows.filter((r) => r.status === 'pending' || r.status === 'error')
    for (const row of pending) {
      if (abortRef.current) break
      await uploadOne(row)
    }
    setBusy(false)
  }

  const confirmAll = async () => {
    setBusy(true)
    setBanner('')
    abortRef.current = false
    const ready = rows.filter((r) => r.status === 'ready' && r.storageKey)
    if (!ready.length) {
      setBanner('Upload files first, then review metadata before submit.')
      setBusy(false)
      return
    }

    const payloads: IsoConfirmUploadPayload[] = ready.map((r) => ({
      storageKey: r.storageKey!,
      originalFilename: r.file.name,
      contentType: r.file.type || 'application/octet-stream',
      fileSize: r.file.size,
      checksumSha256: r.checksumSha256,
      title: r.title.trim(),
      documentCode: r.documentCode.trim() || undefined,
      documentType: r.documentType,
      department: r.department,
      confidentiality: r.confidentiality,
      // Never auto-publish bulk uploads to Auditor Room
      publishToAuditorRoom: false,
      auditorDownloadAllowed: false,
    }))

    try {
      ready.forEach((r) => updateRow(r.id, { status: 'confirming' }))
      try {
        const result = await confirmIsoBulkUpload(payloads)
        const errors = result.errors || []
        ready.forEach((r, index) => {
          const err = errors.find((e) => e.index === index)
          updateRow(r.id, {
            status: err ? 'error' : 'done',
            error: err?.error,
            progress: err ? 0 : 100,
          })
        })
      } catch {
        // Fallback: confirm one-by-one if bulk endpoint unavailable
        for (const r of ready) {
          if (abortRef.current) break
          try {
            const payload = payloads.find((p) => p.storageKey === r.storageKey)!
            await confirmIsoUpload(payload)
            updateRow(r.id, { status: 'done', progress: 100 })
          } catch (err) {
            updateRow(r.id, {
              status: 'error',
              error: err instanceof Error ? err.message : 'Confirm failed',
            })
          }
        }
      }
      onCompleted?.()
      setBanner('Upload complete. Documents saved as drafts — not published to Auditor Room.')
    } finally {
      setBusy(false)
    }
  }

  const stats = useMemo(() => {
    const total = rows.length
    const done = rows.filter((r) => r.status === 'done').length
    const ready = rows.filter((r) => r.status === 'ready').length
    const err = rows.filter((r) => r.status === 'error').length
    return { total, done, ready, err }
  }, [rows])

  return (
    <Modal title="Bulk document upload" open={open} onClose={handleClose} panelClassName="modal-panel--wide">
      <div className="iso-page" style={{ gap: '0.75rem' }}>
        <p className="iso-muted">
          Drag and drop multiple files, review metadata, then submit. Bulk uploads are never
          published to the Auditor Room automatically.
        </p>

        {banner ? <div className="iso-error">{banner}</div> : null}

        <div
          className={`iso-upload-drop ${dragActive ? 'iso-upload-drop--active' : ''}`}
          onDragEnter={(e) => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragActive(false)
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
          }}
        >
          <p>Drop PDF, Office, CSV, TXT, JPG or PNG files here (max 50 MB each)</p>
          <button type="button" className="btn btn--secondary" onClick={() => inputRef.current?.click()}>
            Browse files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        <div className="iso-inline-actions">
          <input
            className="iso-filters__input"
            style={{ maxWidth: 220 }}
            placeholder="Mass-assign department"
            value={massDept}
            onChange={(e) => setMassDept(e.target.value)}
          />
          <button type="button" className="btn btn--secondary" onClick={applyMassDepartment}>
            Apply department
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy || !rows.some((r) => r.status === 'pending' || r.status === 'error')}
            onClick={uploadAllPending}
          >
            Upload to storage
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || stats.ready === 0}
            onClick={confirmAll}
          >
            Review &amp; submit ({stats.ready})
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              abortRef.current = true
              setBusy(false)
            }}
          >
            Cancel pending
          </button>
        </div>

        <div className="iso-muted">
          {stats.total} file(s) · {stats.ready} ready · {stats.done} saved · {stats.err} failed
        </div>

        <div className="iso-upload-list">
          {rows.map((row) => (
            <div key={row.id} className="iso-upload-row">
              <div>
                <div>{row.file.name}</div>
                <div className="iso-muted">
                  {formatFileSize(row.file.size)} · {row.status}
                  {row.error ? ` — ${row.error}` : ''}
                </div>
                <div className="iso-progress" aria-hidden>
                  <div className="iso-progress__bar" style={{ width: `${row.progress}%` }} />
                </div>
              </div>
              <input
                value={row.title}
                onChange={(e) => updateRow(row.id, { title: e.target.value })}
                placeholder="Title"
                disabled={row.status === 'done'}
              />
              <input
                value={row.documentCode}
                onChange={(e) => updateRow(row.id, { documentCode: e.target.value })}
                placeholder="Code"
                disabled={row.status === 'done'}
              />
              <input
                value={row.department}
                onChange={(e) => updateRow(row.id, { department: e.target.value })}
                placeholder="Dept"
                disabled={row.status === 'done'}
              />
              <div className="iso-inline-actions">
                {row.status === 'error' ? (
                  <button type="button" className="btn btn--secondary" onClick={() => retryRow(row.id)}>
                    Retry
                  </button>
                ) : null}
                {row.status !== 'done' && row.status !== 'cancelled' ? (
                  <button type="button" className="btn btn--secondary" onClick={() => cancelRow(row.id)}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
