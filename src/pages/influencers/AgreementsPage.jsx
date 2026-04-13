import { useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useInfluencers } from '../../contexts/InfluencersContext'
import './influencers.css'

const COMPANY_NAME = 'Basmat Al Hayat General Trading LLC'

function AgreementPreview({ inf, onClose }) {
  const handlePrint = () => window.print()

  return (
    <div className="inf-modal-overlay" onClick={onClose}>
      <div className="inf-modal inf-modal--wide" onClick={e => e.stopPropagation()}>
        <div className="inf-modal__header">
          <span className="inf-modal__title">Agreement — {inf.name}</span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="inf-btn inf-btn--ghost inf-btn--sm" onClick={handlePrint}>🖨 Print / Download</button>
            <button className="inf-modal__close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="inf-modal__body" style={{ padding: 0 }}>
          <div className="inf-agreement">
            {/* Header */}
            <div className="inf-agreement__header">
              <div className="inf-agreement__company">{COMPANY_NAME}</div>
              <div className="inf-agreement__doc-title">Influencer Collaboration Agreement</div>
            </div>

            <div className="inf-agreement__body">
              {/* Date & Ref */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                <span>Date: {new Date().toLocaleDateString('en-AE', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                <span>Ref: INF-{inf.id}-{new Date().getFullYear()}</span>
              </div>

              {/* Parties */}
              <div className="inf-agreement__section">
                <div className="inf-agreement__section-title">Parties</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>Company</div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{COMPANY_NAME}</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>United Arab Emirates</div>
                  </div>
                  <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>Influencer</div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{inf.name}</div>
                    {inf.instagram?.handle && <div style={{ fontSize: '0.82rem', color: 'var(--accent)', marginTop: '0.15rem' }}>{inf.instagram.handle}</div>}
                    {inf.mobile && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{inf.mobile}</div>}
                    {inf.nationality && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{inf.nationality}{inf.basedIn ? ` · Based in ${inf.basedIn}` : ''}</div>}
                  </div>
                </div>
              </div>

              {/* Social Handles */}
              {(inf.instagram?.handle || inf.youtube?.handle || inf.tiktok?.handle) && (
                <div className="inf-agreement__section">
                  <div className="inf-agreement__section-title">Social Media Channels</div>
                  <div style={{ fontSize: '0.875rem', lineHeight: 1.7 }}>
                    {inf.instagram?.handle && <div>Instagram: <strong>{inf.instagram.handle}</strong>{inf.instagram?.url ? ` — ${inf.instagram.url}` : ''}</div>}
                    {inf.youtube?.handle && <div>YouTube: <strong>{inf.youtube.handle}</strong></div>}
                    {inf.tiktok?.handle && <div>TikTok: <strong>{inf.tiktok.handle}</strong></div>}
                    {inf.snapchat && <div>Snapchat: <strong>{inf.snapchat}</strong></div>}
                  </div>
                </div>
              )}

              {/* Deliverables */}
              <div className="inf-agreement__section">
                <div className="inf-agreement__section-title">Agreed Deliverables</div>
                <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '1rem', fontSize: '0.875rem', lineHeight: 1.7 }}>
                  <div><strong>Collaboration Type:</strong> {inf.collaborationType || 'As agreed'}</div>
                  {inf.deliverables && <div><strong>Deliverables:</strong> {inf.deliverables}</div>}
                  {inf.reelsPrice && <div><strong>Reels Price:</strong> {inf.currency} {Number(inf.reelsPrice).toLocaleString()}</div>}
                  {inf.storiesPrice && <div><strong>Stories Price:</strong> {inf.currency} {Number(inf.storiesPrice).toLocaleString()}</div>}
                  {inf.packagePrice && <div><strong>Total Package Price:</strong> {inf.currency} {Number(inf.packagePrice).toLocaleString()}</div>}
                  {inf.shootDate && <div><strong>Shoot Date:</strong> {inf.shootDate}{inf.shootTime ? ` at ${inf.shootTime}` : ''}</div>}
                  {inf.shootLocation && <div><strong>Location:</strong> {inf.shootLocation}</div>}
                  {inf.campaign && <div><strong>Campaign:</strong> {inf.campaign}</div>}
                </div>
              </div>

              {/* Commitments */}
              <div className="inf-agreement__section">
                <div className="inf-agreement__section-title">Commitments</div>
                <div style={{ fontSize: '0.875rem', lineHeight: 1.8 }}>
                  <p>The Influencer agrees to:</p>
                  <ul style={{ margin: '0.5rem 0 0 1.25rem', paddingLeft: 0 }}>
                    <li>Create and publish the agreed deliverables on the specified social media channels.</li>
                    <li>Ensure all content meets the brand guidelines provided by {COMPANY_NAME}.</li>
                    {inf.reelStaysOnPage && <li>Keep the published reel/post on their page for a minimum period of 6 months.</li>}
                    <li>Not remove or archive the content without written consent from {COMPANY_NAME}.</li>
                    <li>Disclose the collaboration as per UAE and platform guidelines.</li>
                  </ul>
                </div>
              </div>

              {/* Rights Clause */}
              <div className="inf-agreement__section">
                <div className="inf-agreement__section-title">Content Rights & Usage</div>
                <div className="inf-agreement__clause">
                  The Influencer hereby irrevocably grants <strong>{COMPANY_NAME}</strong> full and exclusive rights to all content, videos, images, and creative materials produced under this collaboration agreement. {COMPANY_NAME} has the unrestricted right to use, reproduce, distribute, and repurpose all such content across its own platforms, channels, social media pages, websites, paid advertising campaigns, and any other media — both digital and physical — without requiring further consent or additional compensation to the Influencer. These rights are granted in perpetuity and apply globally. The Influencer confirms they hold all rights to the content and that it does not infringe upon any third-party rights.
                </div>
              </div>

              {/* Payment */}
              {(inf.packagePrice || inf.bankName) && (
                <div className="inf-agreement__section">
                  <div className="inf-agreement__section-title">Payment Terms</div>
                  <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '1rem', fontSize: '0.875rem', lineHeight: 1.7 }}>
                    {inf.packagePrice && <div><strong>Total Agreed Amount:</strong> {inf.currency} {Number(inf.packagePrice).toLocaleString()}</div>}
                    {inf.paymentMethod && <div><strong>Payment Method:</strong> {inf.paymentMethod}</div>}
                    {inf.bankName && <div><strong>Bank:</strong> {inf.bankName}</div>}
                    {inf.accountTitle && <div><strong>Account Title:</strong> {inf.accountTitle}</div>}
                    {inf.iban && <div><strong>IBAN:</strong> {inf.iban}</div>}
                    <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      Payment will be processed upon confirmation of content publication and receipt of all deliverables.
                    </div>
                  </div>
                </div>
              )}

              {/* Approval Notes */}
              {inf.approvalNotes && (
                <div className="inf-agreement__section">
                  <div className="inf-agreement__section-title">Additional Notes</div>
                  <div style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text)' }}>{inf.approvalNotes}</div>
                </div>
              )}

              {/* Signatures */}
              <div className="inf-agreement__signatures">
                <div className="inf-agreement__sig-block">
                  <div className="inf-agreement__sig-line" />
                  <div className="inf-agreement__sig-label">Authorised Signatory</div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text)', marginTop: '0.25rem' }}>{COMPANY_NAME}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Date: ___________________</div>
                </div>
                <div className="inf-agreement__sig-block">
                  <div className="inf-agreement__sig-line" />
                  <div className="inf-agreement__sig-label">Influencer Signature</div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text)', marginTop: '0.25rem' }}>{inf.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Date: ___________________</div>
                </div>
              </div>

              <div style={{ marginTop: '2rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                This agreement is binding upon both parties once signed. For queries contact {COMPANY_NAME}.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AgreementsPage() {
  const { influencers, updateInfluencer } = useInfluencers()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const previewId = searchParams.get('id')

  const [previewInf, setPreviewInf] = useState(() => previewId ? influencers.find(i => i.id === previewId) : null)
  const [filterStatus, setFilterStatus] = useState('All')
  const [search, setSearch] = useState('')

  const stats = useMemo(() => ({
    total: influencers.filter(i => i.agreementGenerated).length,
    signed: influencers.filter(i => i.agreementStatus === 'Signed').length,
    pending: influencers.filter(i => i.approvalStatus === 'Approved' && !i.agreementGenerated).length,
    approved: influencers.filter(i => i.approvalStatus === 'Approved').length,
  }), [influencers])

  const filtered = useMemo(() => {
    let list = influencers.filter(i => i.approvalStatus === 'Approved' || i.agreementGenerated)
    if (filterStatus === 'Generated') list = list.filter(i => i.agreementGenerated && i.agreementStatus !== 'Signed')
    else if (filterStatus === 'Signed') list = list.filter(i => i.agreementStatus === 'Signed')
    else if (filterStatus === 'Pending') list = list.filter(i => !i.agreementGenerated)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(i => [i.name, i.instagram?.handle].some(v => v?.toLowerCase().includes(q)))
    }
    return list
  }, [influencers, filterStatus, search])

  const generateAgreement = (inf) => {
    updateInfluencer(inf.id, { agreementGenerated: true, agreementStatus: 'Generated' })
    setPreviewInf({ ...inf, agreementGenerated: true, agreementStatus: 'Generated' })
  }

  return (
    <div className="inf-page">
      <div className="inf-page-header">
        <div>
          <h1 className="inf-page-title">Agreements</h1>
          <p className="inf-page-subtitle">{COMPANY_NAME}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="inf-stats-row">
        <div className="inf-stat inf-stat--blue">
          <div className="inf-stat__value">{stats.approved}</div>
          <div className="inf-stat__label">Approved Influencers</div>
        </div>
        <div className="inf-stat inf-stat--amber">
          <div className="inf-stat__value">{stats.pending}</div>
          <div className="inf-stat__label">Agreement Pending</div>
        </div>
        <div className="inf-stat inf-stat--purple">
          <div className="inf-stat__value">{stats.total}</div>
          <div className="inf-stat__label">Generated</div>
        </div>
        <div className="inf-stat inf-stat--green">
          <div className="inf-stat__value">{stats.signed}</div>
          <div className="inf-stat__label">Signed</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="inf-toolbar">
        <div className="inf-search-wrap">
          <span className="inf-search-icon">🔍</span>
          <input className="inf-search" placeholder="Search influencer…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="inf-filter-chips">
          {['All', 'Pending', 'Generated', 'Signed'].map(s => (
            <button key={s} className={`inf-chip ${filterStatus === s ? 'inf-chip--active' : ''}`} onClick={() => setFilterStatus(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="inf-table-wrap">
        {filtered.length === 0 ? (
          <div className="inf-empty">
            <div className="inf-empty__icon">📄</div>
            <div className="inf-empty__title">No agreements yet</div>
            <div className="inf-empty__desc">Approve influencers first to generate agreements.</div>
          </div>
        ) : (
          <table className="inf-table">
            <thead>
              <tr>
                <th>Influencer</th>
                <th>Instagram</th>
                <th>Package</th>
                <th>Campaign</th>
                <th>Generated</th>
                <th>Signed by Influencer</th>
                <th>Signed by Company</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inf => (
                <tr key={inf.id} onClick={() => navigate(`/influencers/${inf.id}`)}>
                  <td><div className="inf-table__name">{inf.name}</div></td>
                  <td><span className="inf-table__handle">{inf.instagram?.handle || '—'}</span></td>
                  <td><span style={{ fontWeight: 700 }}>{inf.packagePrice ? `${inf.currency} ${Number(inf.packagePrice).toLocaleString()}` : '—'}</span></td>
                  <td className="wrap"><span className="inf-table__muted">{inf.campaign || '—'}</span></td>
                  <td>
                    <span className={`inf-badge ${inf.agreementGenerated ? 'inf-badge--approved' : 'inf-badge--waiting'}`}>
                      {inf.agreementGenerated ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>
                    <span className={`inf-badge ${inf.signedByInfluencer ? 'inf-badge--approved' : 'inf-badge--waiting'}`}>
                      {inf.signedByInfluencer ? 'Signed' : 'Pending'}
                    </span>
                  </td>
                  <td>
                    <span className={`inf-badge ${inf.signedByCompany ? 'inf-badge--approved' : 'inf-badge--waiting'}`}>
                      {inf.signedByCompany ? 'Signed' : 'Pending'}
                    </span>
                  </td>
                  <td>
                    <span className={`inf-badge inf-badge--dot ${inf.agreementStatus === 'Signed' ? 'inf-badge--signed' : inf.agreementGenerated ? 'inf-badge--generated' : 'inf-badge--not-requested'}`}>
                      {inf.agreementStatus || 'Not Generated'}
                    </span>
                  </td>
                  <td>
                    <div className="inf-table__actions" onClick={e => e.stopPropagation()}>
                      {!inf.agreementGenerated ? (
                        <button className="inf-btn inf-btn--primary inf-btn--xs" onClick={() => generateAgreement(inf)}>
                          Generate
                        </button>
                      ) : (
                        <>
                          <button className="inf-btn inf-btn--ghost inf-btn--xs" onClick={() => setPreviewInf(inf)}>
                            Preview
                          </button>
                          {!inf.signedByInfluencer && (
                            <button className="inf-btn inf-btn--success inf-btn--xs"
                              onClick={() => updateInfluencer(inf.id, { signedByInfluencer: true, signedByCompany: true, agreementStatus: 'Signed' })}>
                              Mark Signed
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Agreement Preview Modal */}
      {previewInf && (
        <AgreementPreview
          inf={previewInf}
          onClose={() => setPreviewInf(null)}
        />
      )}
    </div>
  )
}
