import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '../../components/Modal'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoFiltersBar } from './components/IsoFiltersBar'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import { IsoFilePreview } from './components/IsoFilePreview'
import { useIsoSearch } from './hooks/useIsoSearch'
import './isoQms.css'

export function IsoSearchPage() {
  const { items, total, loading, error, search } = useIsoSearch()
  const [filters, setFilters] = useState({
    q: '',
    documentType: '',
    status: '',
    department: '',
    clause: '',
    currentOnly: 'true',
  })
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null)

  const runSearch = () => {
    search({
      q: filters.q,
      documentType: filters.documentType || undefined,
      status: filters.status || undefined,
      department: filters.department || undefined,
      clause: filters.clause || undefined,
      currentOnly: filters.currentOnly === 'true',
    })
  }

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="ISO Search"
          subtitle="Dedicated QMS full-text search across controlled documents, findings, corrective actions, audits and extracted content. Separate from the application global search."
        />
        {error ? <div className="iso-error">{error}</div> : null}
        <IsoFiltersBar
          fields={[
            { key: 'q', placeholder: 'Search keywords or "exact phrase"' },
            { key: 'documentType', placeholder: 'Document type' },
            { key: 'status', placeholder: 'Status' },
            { key: 'department', placeholder: 'Department' },
            { key: 'clause', placeholder: 'ISO clause' },
            {
              key: 'currentOnly',
              type: 'select',
              placeholder: 'Revisions',
              options: [
                { value: 'true', label: 'Current only' },
                { value: 'false', label: 'Include history' },
              ],
            },
          ]}
          values={filters}
          onChange={(next) => setFilters(next)}
          trailing={
            <button type="button" className="btn btn--primary" onClick={runSearch}>
              Search
            </button>
          }
        />

        {loading ? <IsoLoadingState message="Searching ISO content…" /> : null}

        {!loading && !items.length ? (
          <IsoEmptyState message="Enter keywords to search the ISO & QMS corpus." />
        ) : null}

        {!loading && items.length > 0 ? (
          <>
            <div className="iso-muted">{total} result{total === 1 ? '' : 's'}</div>
            <div className="iso-auditor-sections">
              {items.map((item) => (
                <article key={`${item.entityType}-${item.id}`} className="iso-search-card">
                  <div className="iso-inline-actions" style={{ justifyContent: 'space-between' }}>
                    <h3 className="iso-search-card__title">
                      {item.documentCode ? `${item.documentCode} — ` : ''}
                      {item.title}
                    </h3>
                    <IsoStatusBadge status={item.status} />
                  </div>
                  <div className="iso-muted">
                    {item.entityType}
                    {item.category ? ` · ${item.category}` : ''}
                    {item.department ? ` · ${item.department}` : ''}
                    {item.clause ? ` · Clause ${item.clause}` : ''}
                    {item.revision ? ` · Rev ${item.revision}` : ''}
                    {item.isObsolete ? ' · Obsolete' : ''}
                  </div>
                  {item.snippet ? (
                    <p
                      className="iso-search-card__snippet"
                      dangerouslySetInnerHTML={{ __html: item.snippet }}
                    />
                  ) : null}
                  <div className="iso-inline-actions">
                    {item.documentId ? (
                      <Link className="btn btn--secondary" to={`/iso-qms/documents?search=${encodeURIComponent(item.documentCode || item.title)}`}>
                        View in library
                      </Link>
                    ) : null}
                    {item.versionId ? (
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={() => setPreviewVersionId(Number(item.versionId))}
                      >
                        Preview
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <Modal
        title="Preview"
        open={previewVersionId != null}
        onClose={() => setPreviewVersionId(null)}
        panelClassName="modal-panel--wide"
      >
        {previewVersionId != null ? <IsoFilePreview versionId={previewVersionId} /> : null}
      </Modal>
    </div>
  )
}
