import { Link, useNavigate } from 'react-router-dom'
import { IsoPageHeader } from './components/IsoPageHeader'
import { IsoSummaryCards } from './components/IsoSummaryCards'
import { IsoLoadingState, IsoEmptyState } from './components/IsoEmptyState'
import { IsoStatusBadge } from './components/IsoStatusBadge'
import { useIsoDashboard } from './hooks/useIsoDashboard'
import { formatIsoDate, formatIsoDateTime } from './utils/isoFormat'
import './isoQms.css'

export function IsoDashboardPage() {
  const navigate = useNavigate()
  const { stats, loading, error } = useIsoDashboard()

  const cards = [
    {
      key: 'total',
      label: 'Controlled documents',
      value: stats.totalControlledDocuments || 0,
      onClick: () => navigate('/iso-qms/documents'),
    },
    {
      key: 'approved',
      label: 'Current / approved',
      value: stats.currentApprovedDocuments || 0,
      tone: 'ok' as const,
      onClick: () => navigate('/iso-qms/documents?status=Current'),
    },
    {
      key: 'draft',
      label: 'Draft / pending',
      value: stats.draftOrPendingDocuments || 0,
      tone: 'warn' as const,
      onClick: () => navigate('/iso-qms/documents?status=Draft'),
    },
    {
      key: 'obsolete',
      label: 'Obsolete',
      value: stats.obsoleteDocuments || 0,
      tone: 'danger' as const,
      onClick: () => navigate('/iso-qms/documents?status=Obsolete'),
    },
    {
      key: 'records',
      label: 'QMS records',
      value: stats.totalQmsRecords || 0,
      onClick: () => navigate('/iso-qms/master-records'),
    },
    {
      key: 'review',
      label: 'Require review',
      value: stats.documentsRequiringReview || 0,
      tone: 'warn' as const,
      onClick: () => navigate('/iso-qms/documents?reviewDue=true'),
    },
    {
      key: 'certs',
      label: 'Expired certificates',
      value: stats.expiredExternalCertificates || 0,
      tone: 'danger' as const,
      onClick: () => navigate('/iso-qms/certificates?status=Expired'),
    },
    {
      key: 'findings',
      label: 'Open findings',
      value: stats.openAuditFindings || 0,
      tone: 'warn' as const,
      onClick: () => navigate('/iso-qms/findings?status=Open'),
    },
    {
      key: 'ca',
      label: 'Overdue CA',
      value: stats.overdueCorrectiveActions || 0,
      tone: 'danger' as const,
      onClick: () => navigate('/iso-qms/findings?overdue=true'),
    },
    {
      key: 'risks',
      label: 'Open risks',
      value: stats.openRisksRequiringAction || 0,
      tone: 'warn' as const,
      onClick: () => navigate('/iso-qms/risks?status=Open'),
    },
    {
      key: 'cal',
      label: 'Upcoming calibration',
      value: stats.upcomingCalibrationDates || 0,
      tone: 'info' as const,
      onClick: () => navigate('/iso-qms/calibration?upcoming=true'),
    },
    {
      key: 'mrm',
      label: 'Upcoming MRM',
      value: stats.upcomingManagementReviews || 0,
      tone: 'info' as const,
      onClick: () => navigate('/iso-qms/management-reviews?upcoming=true'),
    },
    {
      key: 'audits',
      label: 'Upcoming audits',
      value: stats.upcomingAudits || 0,
      tone: 'info' as const,
      onClick: () => navigate('/iso-qms/audits?upcoming=true'),
    },
  ]

  return (
    <div className="page">
      <div className="iso-page">
        <IsoPageHeader
          title="QMS Dashboard"
          subtitle="Audit-ready overview of controlled documents, findings, and surveillance readiness. Counts reflect live database values only."
          actions={
            <div className="iso-quick-links">
              <Link className="btn btn--primary" to="/iso-qms/documents">
                Upload / library
              </Link>
              <Link className="btn btn--secondary" to="/iso-qms/search">
                ISO Search
              </Link>
              <Link className="btn btn--secondary" to="/iso-qms/audits">
                Begin audit
              </Link>
              <Link className="btn btn--secondary" to="/iso-qms/auditor-room">
                Auditor Room
              </Link>
            </div>
          }
        />

        {error ? <div className="iso-error">{error}</div> : null}
        {loading ? <IsoLoadingState message="Loading QMS dashboard…" /> : null}

        {!loading ? <IsoSummaryCards items={cards} /> : null}

        <div className="iso-grid-2">
          <section className="iso-section-card">
            <h2 className="iso-section-card__title">Audit readiness checklist</h2>
            <p className="iso-section-card__meta">
              Transparent counts — not a synthetic readiness percentage.
            </p>
            {(stats.checklist || []).length === 0 ? (
              <IsoEmptyState message="Checklist will populate once required document codes and record types are configured." />
            ) : (
              <ul className="iso-checklist">
                {(stats.checklist || []).map((item) => (
                  <li key={item.key} className="iso-checklist__item">
                    <span>
                      {item.current} of {item.required} {item.label}
                    </span>
                    {item.filterPath ? (
                      <Link to={item.filterPath}>Open</Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="iso-section-card">
            <h2 className="iso-section-card__title">Documents awaiting approval</h2>
            {(stats.awaitingApproval || []).length === 0 ? (
              <IsoEmptyState message="No documents awaiting approval." />
            ) : (
              <div className="iso-table-wrap">
                <table className="iso-table" style={{ minWidth: 480 }}>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Title</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stats.awaitingApproval || []).slice(0, 8).map((doc) => (
                      <tr key={doc.id}>
                        <td className="iso-code">{doc.documentCode}</td>
                        <td>{doc.title}</td>
                        <td>
                          <IsoStatusBadge status={doc.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="iso-grid-3">
          <section className="iso-section-card">
            <h2 className="iso-section-card__title">Recent uploads</h2>
            {(stats.recentUploads || []).length === 0 ? (
              <IsoEmptyState message="No uploads yet." />
            ) : (
              <ul className="iso-checklist">
                {(stats.recentUploads || []).slice(0, 6).map((doc) => (
                  <li key={doc.id} className="iso-checklist__item">
                    <span>
                      {doc.documentCode || doc.title}
                      <div className="iso-muted">{formatIsoDate(doc.uploadedAt || doc.createdAt)}</div>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="iso-section-card">
            <h2 className="iso-section-card__title">Corrective actions due</h2>
            {(stats.correctiveActionsDue || []).length === 0 ? (
              <IsoEmptyState message="No corrective actions approaching due date." />
            ) : (
              <ul className="iso-checklist">
                {(stats.correctiveActionsDue || []).slice(0, 6).map((ca) => (
                  <li key={ca.id} className="iso-checklist__item">
                    <span>
                      {ca.caNumber}
                      <div className="iso-muted">Due {formatIsoDate(ca.targetDate)}</div>
                    </span>
                    <IsoStatusBadge status={ca.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="iso-section-card">
            <h2 className="iso-section-card__title">Recent QMS activity</h2>
            {(stats.recentActivity || []).length === 0 ? (
              <IsoEmptyState message="No activity logged yet." />
            ) : (
              <ul className="iso-checklist">
                {(stats.recentActivity || []).slice(0, 8).map((entry) => (
                  <li key={entry.id} className="iso-checklist__item">
                    <span>
                      {entry.message || entry.action}
                      <div className="iso-muted">{formatIsoDateTime(entry.createdAt)}</div>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="iso-grid-2">
          <section className="iso-section-card">
            <h2 className="iso-section-card__title">Expired / expiring certificates</h2>
            {(stats.expiredCertificates || []).length === 0 ? (
              <IsoEmptyState message="No expired certificates." />
            ) : (
              <ul className="iso-checklist">
                {(stats.expiredCertificates || []).slice(0, 6).map((c) => (
                  <li key={c.id} className="iso-checklist__item">
                    <span>
                      {c.title}
                      <div className="iso-muted">Expiry {formatIsoDate(c.expiryDate)}</div>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="iso-section-card">
            <h2 className="iso-section-card__title">Calibration due dates</h2>
            {(stats.calibrationsDue || []).length === 0 ? (
              <IsoEmptyState message="No upcoming calibrations." />
            ) : (
              <ul className="iso-checklist">
                {(stats.calibrationsDue || []).slice(0, 6).map((c) => (
                  <li key={c.id} className="iso-checklist__item">
                    <span>
                      {c.equipmentName || c.equipmentNumber || c.certificateNumber}
                      <div className="iso-muted">Due {formatIsoDate(c.dueDate)}</div>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
