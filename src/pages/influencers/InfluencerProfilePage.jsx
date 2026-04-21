import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  List,
  Sparkles,
  User,
  Pencil,
  RefreshCw,
  Check,
  X,
  Trash2,
} from 'lucide-react'
import { resolveApiUrl } from '../../api/client'
import { useInfluencers, WORKFLOW_STAGES } from '../../contexts/InfluencersContext'
import { useAuth, hasPermission } from '../../contexts/AuthContext'
import { InsightsImagesSection } from './InsightsImagesSection'
import './influencers.css'

function wfBadge(status) {
  const map = {
    'Approved': 'inf-badge--approved', 'Rejected': 'inf-badge--rejected',
    'Shortlisted': 'inf-badge--shortlisted', 'Paid': 'inf-badge--paid',
    'Payment Pending': 'inf-badge--payment', 'Shoot Scheduled': 'inf-badge--scheduled',
    'Uploaded': 'inf-badge--uploaded',
  }
  return `inf-badge inf-badge--dot ${map[status] || 'inf-badge--pending'}`
}

function payBadge(status) {
  const map = {
    'Paid': 'inf-badge--paid', 'Ready for Payment': 'inf-badge--ready',
    'Payment Processing': 'inf-badge--processing', 'Bank Details Pending': 'inf-badge--waiting',
    'Not Requested': 'inf-badge--not-requested',
  }
  return `inf-badge inf-badge--dot ${map[status] || 'inf-badge--not-requested'}`
}

function InstagramProfileCard({ handle, url, storedPicUrl, followersCount, niche }) {
  const username = handle ? handle.replace(/^@/, '') : null
  const [imgError, setImgError] = useState(false)
  if (!username) return null
  const profileUrl = url || `https://www.instagram.com/${username}/`
  const avatarSrc = storedPicUrl || resolveApiUrl(`/api/instagram-proxy/avatar/${encodeURIComponent(username)}`)
  return (
    <a
      href={profileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="ig-profile-card"
    >
      <div className="ig-profile-card__avatar-wrap">
        {!imgError ? (
          <img
            src={avatarSrc}
            alt={username}
            className="ig-profile-card__avatar"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="ig-profile-card__avatar-fallback">
            <span>{username.slice(0, 2).toUpperCase()}</span>
          </div>
        )}
        <div className="ig-profile-card__avatar-ring" />
      </div>
      <div className="ig-profile-card__info">
        <span className="ig-profile-card__name">@{username}</span>
        {(followersCount || niche) && (
          <span className="ig-profile-card__meta">
            {followersCount && <span>{followersCount} followers</span>}
            {followersCount && niche && <span className="ig-profile-card__dot">·</span>}
            {niche && <span>{niche}</span>}
          </span>
        )}
        <span className="ig-profile-card__cta">View on Instagram ↗</span>
      </div>
      <div className="ig-profile-card__logo">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ig-grad" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#f09433"/>
              <stop offset="25%" stopColor="#e6683c"/>
              <stop offset="50%" stopColor="#dc2743"/>
              <stop offset="75%" stopColor="#cc2366"/>
              <stop offset="100%" stopColor="#bc1888"/>
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig-grad)"/>
          <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="1.8" fill="none"/>
          <circle cx="17.5" cy="6.5" r="1.2" fill="white"/>
        </svg>
      </div>
    </a>
  )
}

function KV({ label, value, link }) {
  if (!value) return null
  return (
    <div className="inf-kv">
      <span className="inf-kv__key">{label}</span>
      {link
        ? <a href={link} target="_blank" rel="noopener noreferrer" className="inf-kv__link">{value}</a>
        : <span className="inf-kv__val">{value}</span>}
    </div>
  )
}

/** Normalize stored handle for display (may or may not include @). */
function formatAtHandle(handle) {
  if (handle == null || String(handle).trim() === '') return ''
  const t = String(handle).trim()
  return t.startsWith('@') ? t : `@${t}`
}

function instagramProfileUrl(handle, url) {
  if (url) return url
  const raw = handle ? String(handle).replace(/^@/, '').trim() : ''
  if (!raw) return undefined
  return `https://www.instagram.com/${raw}/`
}

function Section({ icon, title, children, full }) {
  return (
    <div className={`inf-profile-section ${full ? 'inf-profile-section--full' : ''}`}>
      <div className="inf-profile-section__head">
        <span className="inf-profile-section__head-icon">{icon}</span>
        <span className="inf-profile-section__head-title">{title}</span>
      </div>
      <div className="inf-profile-section__body">
        <div className="inf-kv-list">{children}</div>
      </div>
    </div>
  )
}

export function InfluencerProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { influencers, updateInfluencer, updateWorkflowStatus, deleteInfluencer } = useInfluencers()
  const { user } = useAuth()
  const can = (action) => hasPermission(user, 'influencers', action)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [newStage, setNewStage] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  const inf = influencers.find(i => i.id === id)

  if (!inf) {
    return (
      <div className="aif-page">
        <div className="aif-bg-orb aif-bg-orb--tl" aria-hidden />
        <div className="aif-bg-orb aif-bg-orb--tr" aria-hidden />
        <div className="aif-bg-orb aif-bg-orb--bc" aria-hidden />
        <div className="aif-content aif-content--centered">
          <div className="aif-profile-not-found">
            <div className="aif-profile-not-found__icon" aria-hidden>🔍</div>
            <h2 className="aif-profile-not-found__title">Influencer not found</h2>
            <button type="button" className="aif-btn-primary" onClick={() => navigate('/influencers/list')}>
              Back to list
            </button>
          </div>
        </div>
      </div>
    )
  }

  const applyStageChange = () => {
    if (newStage) updateWorkflowStatus(id, newStage)
    setShowStatusModal(false)
  }

  return (
    <div className="aif-page">
      <div className="aif-bg-orb aif-bg-orb--tl" aria-hidden />
      <div className="aif-bg-orb aif-bg-orb--tr" aria-hidden />
      <div className="aif-bg-orb aif-bg-orb--bc" aria-hidden />

      <div className="aif-content">
        <header className="aif-topbar">
          <div className="aif-topbar__text">
            <div className="aif-back-row">
              <button
                type="button"
                className="inf-hero__back-btn"
                onClick={() => navigate('/influencers/list')}
                aria-label="Back to influencer list"
              >
                <List size={16} strokeWidth={2.25} aria-hidden />
                Back to list
              </button>
            </div>
            <div className="aif-eyebrow">
              <Sparkles size={11} aria-hidden />
              Influencer Intelligence System
            </div>
            <h1 className="aif-title">{inf.name}</h1>
            <p className="aif-subtitle">
              {inf.instagram?.handle
                ? formatAtHandle(inf.instagram.handle)
                : inf.youtube?.handle
                  ? inf.youtube.handle
                  : inf.tiktok?.handle
                    ? formatAtHandle(inf.tiktok.handle)
                    : '—'}
              {inf.basedIn ? ` · ${inf.basedIn}` : ''}
            </p>
            <div className="aif-profile-hero-pills" aria-label="Status tags">
              <span className="inf-hero__badge">{inf.workflowStatus}</span>
              <span className="inf-hero__badge">{inf.approvalStatus}</span>
              {inf.niche && <span className="inf-hero__badge">{inf.niche}</span>}
            </div>
          </div>

          <div className="aif-topbar__actions">
            {can('manage') && (
              <button
                type="button"
                className="aif-btn-primary"
                onClick={() => navigate(`/influencers/${id}/edit`)}
              >
                <Pencil size={14} aria-hidden />
                Edit
              </button>
            )}
            {(can('manage') || can('approve')) && (
              <button
                type="button"
                className="aif-btn-ghost"
                onClick={() => { setNewStage(inf.workflowStatus); setShowStatusModal(true) }}
              >
                <RefreshCw size={14} aria-hidden />
                Move stage
              </button>
            )}
            {can('approve') && inf.approvalStatus !== 'Approved' && (
              <button
                type="button"
                className="inf-btn inf-btn--success inf-btn--sm"
                onClick={() => updateInfluencer(id, { approvalStatus: 'Approved', workflowStatus: 'Approved' })}
              >
                <Check size={14} aria-hidden />
                Approve
              </button>
            )}
            {can('approve') && inf.approvalStatus !== 'Rejected' && (
              <button
                type="button"
                className="inf-btn inf-btn--danger inf-btn--sm"
                onClick={() => updateInfluencer(id, { approvalStatus: 'Rejected', workflowStatus: 'Rejected' })}
              >
                <X size={14} aria-hidden />
                Reject
              </button>
            )}
            {can('approve') && inf.approvalStatus === 'Rejected' && (
              <button
                type="button"
                className="inf-btn inf-btn--warning inf-btn--sm"
                onClick={() => updateInfluencer(id, { approvalStatus: 'Pending', workflowStatus: 'Under Review' })}
              >
                Re-activate
              </button>
            )}
            {can('manage') && (
              <button type="button" className="inf-btn inf-btn--danger inf-btn--sm" onClick={() => setShowDeleteModal(true)}>
                <Trash2 size={14} aria-hidden />
                Delete
              </button>
            )}
          </div>
        </header>

        <section className="aif-panel aif-panel--profile">
          <div className="aif-panel__grad" aria-hidden />
          <div className="aif-panel__orb aif-panel__orb--tr" aria-hidden />
          <div className="aif-panel__orb aif-panel__orb--bl" aria-hidden />

          <div className="aif-panel__header">
            <div className="aif-panel__header-left">
              <div className="aif-panel__icon">
                <User size={20} aria-hidden />
              </div>
              <div>
                <span className="aif-panel__step-pill">Profile</span>
                <h2 className="aif-panel__title">Full record</h2>
                <p className="aif-panel__sub">
                  View pipeline, commercial, compliance, and activity for this influencer.
                </p>
              </div>
            </div>
          </div>

          <div className="aif-panel__body">
            <div className="inf-profile-all aif-profile-shell">
        <div className="inf-profile-grid">
          <Section icon="👤" title="Basic Information">
            <KV label="Full Name" value={inf.name} />
            <div className="inf-kv">
              <span className="inf-kv__key">Instagram</span>
              {inf.instagram?.handle ? (
                <a
                  href={instagramProfileUrl(inf.instagram.handle, inf.instagram.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inf-kv__link"
                >
                  {formatAtHandle(inf.instagram.handle)}
                </a>
              ) : (
                <span className="inf-kv__val">—</span>
              )}
            </div>
            <KV label="Mobile" value={inf.mobile} />
            <KV label="WhatsApp" value={inf.whatsapp} />
            <KV label="Email" value={inf.email} />
            <KV label="Nationality" value={inf.nationality} />
            <KV label="Based In" value={inf.basedIn} />
            <KV label="Niche" value={inf.niche} />
            <KV label="Assigned To" value={inf.assignedTo} />
          </Section>
          <Section icon="📊" title="Status Overview">
            <div className="inf-kv">
              <span className="inf-kv__key">Pipeline Stage</span>
              <span className={wfBadge(inf.workflowStatus)}>{inf.workflowStatus}</span>
            </div>
            <div className="inf-kv">
              <span className="inf-kv__key">Approval</span>
              <span className={wfBadge(inf.approvalStatus)}>{inf.approvalStatus}</span>
            </div>
            <div className="inf-kv">
              <span className="inf-kv__key">Payment</span>
              <span className={payBadge(inf.paymentStatus)}>{inf.paymentStatus}</span>
            </div>
            <div className="inf-kv">
              <span className="inf-kv__key">Insights</span>
              <span className={`inf-badge ${inf.insightsReceived ? 'inf-badge--approved' : 'inf-badge--waiting'}`}>
                {inf.insightsReceived ? 'Received' : 'Pending'}
              </span>
            </div>
            <div className="inf-kv">
              <span className="inf-kv__key">Agreement</span>
              <span className={`inf-badge ${inf.agreementStatus === 'Signed' ? 'inf-badge--signed' : inf.agreementGenerated ? 'inf-badge--generated' : 'inf-badge--not-requested'}`}>
                {inf.agreementStatus}
              </span>
            </div>
            <KV label="Contact Status" value={inf.contactStatus} />
            <KV label="Last Updated" value={inf.updatedAt?.split('T')[0]} />
          </Section>
          {inf.notes && (
            <Section icon="📝" title="Notes" full>
              <div style={{ fontSize: '0.875rem', color: 'var(--text)', lineHeight: 1.6 }}>{inf.notes}</div>
            </Section>
          )}
        </div>

        <div className="inf-profile-grid">
          {inf.instagram?.handle && (
            <div className="inf-profile-section inf-profile-section--full">
              <div className="inf-profile-section__head">
                <span className="inf-profile-section__head-icon">📸</span>
                <span className="inf-profile-section__head-title">Instagram Profile</span>
              </div>
              <div className="inf-profile-section__body">
                <InstagramProfileCard
                  handle={inf.instagram.handle}
                  url={inf.instagram.url}
                  storedPicUrl={inf.instagram?.picUrl}
                  followersCount={inf.followersCount}
                  niche={inf.niche}
                />
              </div>
            </div>
          )}
          <Section icon="📱" title="Social Media Handles">
            {inf.instagram?.handle && <KV label="Instagram" value={inf.instagram.handle} link={inf.instagram.url || undefined} />}
            {inf.youtube?.handle && <KV label="YouTube" value={inf.youtube.handle} link={inf.youtube.url || undefined} />}
            {inf.tiktok?.handle && <KV label="TikTok" value={inf.tiktok.handle} link={inf.tiktok.url || undefined} />}
            {inf.snapchat && <KV label="Snapchat" value={inf.snapchat} />}
            {inf.facebook && <KV label="Facebook" value={inf.facebook} />}
            {inf.twitter && <KV label="X / Twitter" value={inf.twitter} />}
            {inf.telegram && <KV label="Telegram" value={inf.telegram} />}
            {inf.website && <KV label="Website" value={inf.website} link={inf.website} />}
            {inf.otherSocial && <KV label="Other" value={inf.otherSocial} />}
          </Section>
          <Section icon="📊" title="Audience Data">
            <KV label="Followers" value={inf.followersCount} />
            <KV label="Engagement Rate" value={inf.engagementRate} />
            <KV label="Avg Reel Views" value={inf.avgReelViews} />
            <KV label="Avg Story Reach" value={inf.avgStoryReach} />
            <KV label="Audience Notes" value={inf.audienceNotes} />
            <div className="inf-kv">
              <span className="inf-kv__key">Insights</span>
              <span className={`inf-badge ${inf.insightsReceived ? 'inf-badge--approved' : 'inf-badge--waiting'}`}>
                {inf.insightsReceived ? 'Received' : 'Not Received'}
              </span>
            </div>
          </Section>
        </div>

        <div className="inf-profile-grid">
          <InsightsImagesSection
            influencerId={id}
            imageKeys={inf.insightsImageKeys}
            canEdit={can('manage') || can('approve')}
            updateInfluencer={updateInfluencer}
          />
        </div>

        <div className="inf-profile-grid">
          <Section icon="💰" title="Pricing">
            <KV label="Reels Price" value={inf.reelsPrice ? `${inf.currency} ${Number(inf.reelsPrice).toLocaleString()}` : undefined} />
            <KV label="Stories Price" value={inf.storiesPrice ? `${inf.currency} ${Number(inf.storiesPrice).toLocaleString()}` : undefined} />
            <KV label="Package Price" value={inf.packagePrice ? `${inf.currency} ${Number(inf.packagePrice).toLocaleString()}` : undefined} />
            <KV label="Currency" value={inf.currency} />
          </Section>
          <Section icon="🤝" title="Collaboration Details">
            <KV label="Type" value={inf.collaborationType} />
            <KV label="Deliverables" value={inf.deliverables} />
            <div className="inf-kv">
              <span className="inf-kv__key">Reel on Page</span>
              <span className="inf-kv__val">{inf.reelStaysOnPage ? 'Yes' : 'No'}</span>
            </div>
            <div className="inf-kv">
              <span className="inf-kv__key">Brand Content</span>
              <span className="inf-kv__val">{inf.contentForBrand ? 'Yes — usage rights included' : 'No'}</span>
            </div>
          </Section>
        </div>

        <div className="inf-profile-grid">
          <Section icon="💬" title="Contact & Negotiation">
            <KV label="Contact Status" value={inf.contactStatus} />
            <div className="inf-kv">
              <span className="inf-kv__key">Offer Shared</span>
              <span className="inf-kv__val">{inf.offerShared ? 'Yes' : 'No'}</span>
            </div>
            <KV label="Follow-up" value={inf.followUpReminder} />
          </Section>
          <Section icon="📝" title="Notes">
            {inf.discussionNotes && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.3rem' }}>Discussion</div>
                <div style={{ fontSize: '0.875rem', lineHeight: 1.6 }}>{inf.discussionNotes}</div>
              </div>
            )}
            {inf.negotiationNotes && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.3rem', marginTop: '0.75rem' }}>Negotiation</div>
                <div style={{ fontSize: '0.875rem', lineHeight: 1.6 }}>{inf.negotiationNotes}</div>
              </div>
            )}
            {inf.approvalNotes && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.3rem', marginTop: '0.75rem' }}>Approval Notes</div>
                <div style={{ fontSize: '0.875rem', lineHeight: 1.6 }}>{inf.approvalNotes}</div>
              </div>
            )}
            {inf.rejectionNotes && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.3rem', marginTop: '0.75rem' }}>Rejection Notes</div>
                <div style={{ fontSize: '0.875rem', lineHeight: 1.6 }}>{inf.rejectionNotes}</div>
              </div>
            )}
          </Section>
        </div>

        <div className="inf-profile-grid">
          <Section icon="🏦" title="Bank Details">
            <KV label="Bank" value={inf.bankName} />
            <KV label="Account Title" value={inf.accountTitle} />
            <KV label="IBAN" value={inf.iban} />
            <KV label="Method" value={inf.paymentMethod} />
            <KV label="Notes" value={inf.paymentNotes} />
          </Section>
          <Section icon="💳" title="Payment Status">
            <div className="inf-kv">
              <span className="inf-kv__key">Status</span>
              <span className={payBadge(inf.paymentStatus)}>{inf.paymentStatus}</span>
            </div>
            <KV label="Agreed Amount" value={inf.packagePrice ? `${inf.currency} ${Number(inf.packagePrice).toLocaleString()}` : undefined} />
            {can('payments') && inf.approvalStatus === 'Approved' && inf.paymentStatus !== 'Paid' && (
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="inf-btn inf-btn--warning inf-btn--sm"
                  onClick={() => updateInfluencer(id, { paymentStatus: 'Ready for Payment' })}>
                  Mark Ready for Payment
                </button>
                <button className="inf-btn inf-btn--success inf-btn--sm"
                  onClick={() => updateInfluencer(id, { paymentStatus: 'Paid', workflowStatus: 'Paid' })}>
                  Mark Paid
                </button>
              </div>
            )}
          </Section>
        </div>

        <div className="inf-profile-grid">
          <Section icon="📅" title="Shoot Details">
            <KV label="Shoot Date" value={inf.shootDate} />
            <KV label="Shoot Time" value={inf.shootTime} />
            <KV label="Location" value={inf.shootLocation} />
            <KV label="Campaign" value={inf.campaign} />
            <KV label="Assigned To" value={inf.assignedTo} />
          </Section>
          <Section icon="📸" title="Shoot Actions">
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="inf-btn inf-btn--primary inf-btn--sm"
                onClick={() => updateWorkflowStatus(id, 'Shoot Scheduled')}>
                📅 Mark Scheduled
              </button>
              <button className="inf-btn inf-btn--success inf-btn--sm"
                onClick={() => updateWorkflowStatus(id, 'Shot Completed')}>
                ✓ Mark Shot Completed
              </button>
              <button className="inf-btn inf-btn--warning inf-btn--sm"
                onClick={() => updateWorkflowStatus(id, 'Waiting for Upload')}>
                ⏳ Waiting for Upload
              </button>
              <button className="inf-btn inf-btn--success inf-btn--sm"
                onClick={() => updateWorkflowStatus(id, 'Uploaded')}>
                📤 Mark Uploaded
              </button>
            </div>
          </Section>
        </div>

        <div className="inf-profile-grid">
          <Section icon="📄" title="Agreement Status">
            <div className="inf-kv">
              <span className="inf-kv__key">Status</span>
              <span className={`inf-badge ${inf.agreementStatus === 'Signed' ? 'inf-badge--signed' : inf.agreementGenerated ? 'inf-badge--generated' : 'inf-badge--not-requested'}`}>
                {inf.agreementStatus}
              </span>
            </div>
            <div className="inf-kv">
              <span className="inf-kv__key">Generated</span>
              <span className="inf-kv__val">{inf.agreementGenerated ? 'Yes' : 'No'}</span>
            </div>
            <div className="inf-kv">
              <span className="inf-kv__key">Signed by Influencer</span>
              <span className={`inf-badge ${inf.signedByInfluencer ? 'inf-badge--approved' : 'inf-badge--waiting'}`}>
                {inf.signedByInfluencer ? 'Yes' : 'Pending'}
              </span>
            </div>
            <div className="inf-kv">
              <span className="inf-kv__key">Signed by Company</span>
              <span className={`inf-badge ${inf.signedByCompany ? 'inf-badge--approved' : 'inf-badge--waiting'}`}>
                {inf.signedByCompany ? 'Yes' : 'Pending'}
              </span>
            </div>
          </Section>
          <Section icon="⚡" title="Agreement Actions">
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="inf-btn inf-btn--primary inf-btn--sm"
                onClick={async () => {
                  await updateInfluencer(id, { agreementGenerated: true, agreementStatus: 'Generated' })
                  navigate(`/influencers/agreements?id=${id}`)
                }}>
                📄 Generate Agreement
              </button>
              <button className="inf-btn inf-btn--ghost inf-btn--sm"
                onClick={() => navigate(`/influencers/agreements?id=${id}`)}>
                👁 Preview
              </button>
              {inf.agreementGenerated && !inf.signedByInfluencer && (
                <button className="inf-btn inf-btn--success inf-btn--sm"
                  onClick={() => updateInfluencer(id, { signedByInfluencer: true, signedByCompany: true, agreementStatus: 'Signed' })}>
                  ✓ Mark Signed
                </button>
              )}
            </div>
          </Section>
        </div>

        <div className="inf-profile-grid">
          <Section icon="📋" title="Activity Timeline" full>
            {!inf.timeline?.length ? (
              <div className="aif-profile-timeline-empty">
                <span className="aif-profile-timeline-empty__icon" aria-hidden>📋</span>
                <span className="aif-profile-timeline-empty__text">No activity recorded yet</span>
              </div>
            ) : (
              <div className="inf-timeline aif-profile-timeline">
                {[...inf.timeline].reverse().map((item, i) => (
                  <div key={i} className="inf-timeline-item">
                    <div className="inf-timeline-item__event">{item.event}</div>
                    <div className="inf-timeline-item__date">{item.date}</div>
                    {item.note && <div className="inf-timeline-item__note">{item.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
            </div>
          </div>
        </section>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="inf-modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="inf-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="inf-modal__header">
              <span className="inf-modal__title">Delete Influencer</span>
              <button className="inf-modal__close" onClick={() => setShowDeleteModal(false)}>×</button>
            </div>
            <div className="inf-modal__body">
              <p style={{ margin: 0, color: 'var(--text)', lineHeight: 1.6 }}>
                Are you sure you want to permanently delete <strong>{inf.name}</strong>?
                This action cannot be undone.
              </p>
            </div>
            <div className="inf-modal__footer">
              <button className="inf-btn inf-btn--ghost" onClick={() => setShowDeleteModal(false)}>Cancel</button>
              <button className="inf-btn inf-btn--danger" onClick={async () => { await deleteInfluencer(id); navigate('/influencers/list') }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Stage Move Modal */}
      {showStatusModal && (
        <div className="inf-modal-overlay" onClick={() => setShowStatusModal(false)}>
          <div className="inf-modal" onClick={e => e.stopPropagation()}>
            <div className="inf-modal__header">
              <span className="inf-modal__title">Move to Stage</span>
              <button className="inf-modal__close" onClick={() => setShowStatusModal(false)}>×</button>
            </div>
            <div className="inf-modal__body">
              <div className="inf-field">
                <label className="inf-label">Select Stage</label>
                <select className="inf-form-select" value={newStage} onChange={e => setNewStage(e.target.value)}>
                  {WORKFLOW_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="inf-modal__footer">
              <button className="inf-btn inf-btn--ghost" onClick={() => setShowStatusModal(false)}>Cancel</button>
              <button className="inf-btn inf-btn--primary" onClick={applyStageChange}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
