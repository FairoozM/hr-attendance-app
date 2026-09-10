import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createIsoCertificate, fetchIsoCertificates } from '../../api/isoQms'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import { IsoLinkedDocumentsPanel } from './components/IsoLinkedDocumentsPanel'
import type { IsoExternalCertificate } from './types'
import { formatIsoDate } from './utils/isoFormat'
import './isoQms.css'

export function IsoCertificatesPage() {
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'iso_qms', 'edit') || hasPermission(user, 'iso_qms', 'add')
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<IsoExternalCertificate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await fetchIsoCertificates({ status: searchParams.get('status') || undefined }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load certificates')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [searchParams])

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="Certificates & External Documents"
          subtitle="Company ISO certificate, TÜV agreements, supplier certificates, product test reports and regulatory evidence."
          actions={canEdit ? (
            <button type="button" className="btn btn--primary" onClick={async () => {
              try {
                await createIsoCertificate({ title: 'New certificate', status: 'Current' })
                refresh()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Create failed')
              }
            }}>Add certificate</button>
          ) : null}
        />
        {error ? <div className="iso-error">{error}</div> : null}
        {loading ? <IsoLoadingState /> : items.length === 0 ? (
          <IsoEmptyState message="No external certificates registered yet." />
        ) : (
          <div className="iso-table-wrap">
            <table className="iso-table">
              <thead>
                <tr>
                  <th>Title</th><th>Type</th><th>Number</th><th>Issuer</th>
                  <th>Issue</th><th>Expiry</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td>{c.title}</td>
                    <td>{c.certificateType || '—'}</td>
                    <td className="iso-code">{c.certificateNumber || '—'}</td>
                    <td>{c.issuingBody || '—'}</td>
                    <td>{formatIsoDate(c.issueDate)}</td>
                    <td>{formatIsoDate(c.expiryDate)}</td>
                    <td><IsoStatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <IsoLinkedDocumentsPanel
          title="Certificate / external document files"
          filters={{ documentType: 'Certificate' }}
        />
        <IsoLinkedDocumentsPanel
          title="Other external documents"
          filters={{ documentType: 'External Document' }}
        />
      </div>
    </div>
  )
}
