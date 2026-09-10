import { useEffect, useState } from 'react'
import { fetchIsoVersionPreviewUrl } from '../../../api/isoQms'
import { IsoLoadingState } from './IsoEmptyState'

interface IsoFilePreviewProps {
  versionId?: number | null
  filename?: string | null
  contentTypeHint?: string | null
  extractedText?: string | null
}

function isPdf(ct: string, name: string) {
  return ct.includes('pdf') || /\.pdf$/i.test(name)
}

function isImage(ct: string, name: string) {
  return ct.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(name)
}

function isTextLike(ct: string, name: string) {
  return (
    ct.startsWith('text/') ||
    ct.includes('csv') ||
    /\.(txt|csv|md)$/i.test(name) ||
    ct.includes('word') ||
    /\.(docx?|xlsx?)$/i.test(name)
  )
}

export function IsoFilePreview({
  versionId,
  filename,
  contentTypeHint,
  extractedText: extractedProp,
}: IsoFilePreviewProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [contentType, setContentType] = useState(contentTypeHint || '')
  const [extractedText, setExtractedText] = useState(extractedProp || '')
  const [sheets, setSheets] = useState<unknown>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false

    async function load() {
      if (!versionId) {
        setUrl(null)
        return
      }
      setLoading(true)
      setError('')
      try {
        const res = await fetchIsoVersionPreviewUrl(versionId)
        if (cancelled) return
        setContentType(res.contentType || contentTypeHint || '')
        if (res.extractedText) setExtractedText(res.extractedText)
        if (res.sheets) setSheets(res.sheets)
        const nextUrl = res.url
        setUrl(nextUrl)
        if (nextUrl.startsWith('blob:')) revoked = nextUrl
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Preview unavailable')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [versionId, contentTypeHint])

  if (!versionId) {
    return <div className="iso-empty">Select a document version to preview.</div>
  }
  if (loading) return <IsoLoadingState message="Loading preview…" />
  if (error) return <div className="iso-error">{error}</div>

  const name = filename || ''
  const ct = (contentType || '').toLowerCase()

  if (url && isPdf(ct, name)) {
    return (
      <div className="iso-preview">
        <iframe className="iso-preview__frame" title={name || 'PDF preview'} src={url} />
      </div>
    )
  }

  if (url && isImage(ct, name)) {
    return (
      <div className="iso-preview">
        <div className="iso-preview__toolbar">
          <button type="button" className="btn btn--secondary" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            Zoom out
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => setZoom(1)}>
            Reset
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            Zoom in
          </button>
          <span className="iso-muted">{Math.round(zoom * 100)}%</span>
        </div>
        <div className="iso-preview__img-wrap">
          <img
            className="iso-preview__img"
            src={url}
            alt={name || 'Document image'}
            style={{ transform: `scale(${zoom})` }}
          />
        </div>
      </div>
    )
  }

  if (sheets && Array.isArray(sheets)) {
    return (
      <div className="iso-preview">
        <p className="iso-muted">Spreadsheet preview (extracted safely; original file unchanged).</p>
        {(sheets as { name?: string; rows?: string[][] }[]).map((sheet, idx) => (
          <div key={sheet.name || idx} className="iso-section-card">
            <h3 className="iso-section-card__title">{sheet.name || `Sheet ${idx + 1}`}</h3>
            <div className="iso-table-wrap">
              <table className="iso-table">
                <tbody>
                  {(sheet.rows || []).slice(0, 40).map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (extractedText || (url && isTextLike(ct, name))) {
    return (
      <div className="iso-preview">
        <p className="iso-muted">
          Text / extracted content preview. Download the original file for full fidelity.
        </p>
        <pre className="iso-preview__text">{extractedText || 'No extracted text available yet.'}</pre>
        {url && !isTextLike(ct, name) ? (
          <a className="btn btn--secondary" href={url} target="_blank" rel="noreferrer">
            Open file
          </a>
        ) : null}
      </div>
    )
  }

  return (
    <div className="iso-preview">
      <div className="iso-empty">
        Inline preview is not available for this file type.
        {url ? (
          <div style={{ marginTop: '0.75rem' }}>
            <a className="btn btn--primary" href={url} target="_blank" rel="noreferrer">
              Open / download
            </a>
          </div>
        ) : null}
      </div>
    </div>
  )
}
