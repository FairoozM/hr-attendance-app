import { useEffect, useState } from 'react'
import { Modal } from '../../../components/Modal'
import { fetchIsoDocuments } from '../../../api/isoQms'
import type { IsoDocument, IsoDocumentFilters } from '../types'
import { IsoDocumentTable } from './IsoDocumentTable'
import { IsoFilePreview } from './IsoFilePreview'
import { IsoLoadingState } from './IsoEmptyState'

interface IsoLinkedDocumentsPanelProps {
  title?: string
  filters: IsoDocumentFilters
  emptyMessage?: string
}

/** Shared document list filtered by category/type for evidence pages. */
export function IsoLinkedDocumentsPanel({
  title = 'Linked documents',
  filters,
  emptyMessage,
}: IsoLinkedDocumentsPanelProps) {
  const [items, setItems] = useState<IsoDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<IsoDocument | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await fetchIsoDocuments(filters)
        if (!cancelled) setItems(data.items || [])
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load documents')
          setItems([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [JSON.stringify(filters)])

  return (
    <section className="iso-section-card">
      <h2 className="iso-section-card__title">{title}</h2>
      {error ? <div className="iso-error">{error}</div> : null}
      {loading ? (
        <IsoLoadingState />
      ) : (
        <IsoDocumentTable
          documents={items}
          onPreview={setPreview}
          emptyMessage={emptyMessage || 'No linked documents yet. Upload evidence in the Document Library.'}
        />
      )}
      <Modal
        title={preview?.title || 'Preview'}
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        panelClassName="modal-panel--wide"
      >
        {preview ? (
          <IsoFilePreview
            versionId={preview.currentVersionId || preview.currentVersion?.id}
            filename={preview.originalFilename || preview.currentVersion?.originalFilename}
            contentTypeHint={preview.fileType || preview.currentVersion?.fileType}
          />
        ) : null}
      </Modal>
    </section>
  )
}
