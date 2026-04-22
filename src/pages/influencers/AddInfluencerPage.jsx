import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { resolveApiUrl } from '../../api/client'
import {
  User, Smartphone, Mail, Globe2, MapPin, Sparkles,
  Camera, Video, Hash, MessageCircle, Share2, AtSign,
  Users, TrendingUp, Eye, BarChart2, DollarSign, Link2,
  Phone, FileText, CreditCard, Building2, BadgeCheck, Calendar,
  Clock, X, CheckCircle2, List,
} from 'lucide-react'
import {
  useInfluencers,
  WORKFLOW_STAGES, APPROVAL_STATUSES, PAYMENT_STATUSES,
  COLLABORATION_TYPES, CONTACT_STATUSES, CURRENCIES,
} from '../../contexts/InfluencersContext'
import { useAuth, hasPermission } from '../../contexts/AuthContext'
import { InsightsImagesSection } from './InsightsImagesSection'
import './influencers.css'

/* ─── Static data ──────────────────────────────────────────── */
const EMPTY_FORM = {
  name: '', mobile: '', whatsapp: '', email: '', nationality: '', basedIn: '', niche: '', notes: '',
  instagram: { handle: '', url: '' }, youtube: { handle: '', url: '' }, tiktok: { handle: '', url: '' },
  snapchat: '', facebook: '', twitter: '', telegram: '', website: '', otherSocial: '',
  followersCount: '', engagementRate: '', avgReelViews: '', avgStoryReach: '',
  audienceNotes: '', insightsReceived: false,
  reelsPrice: '', storiesPrice: '', packagePrice: '', currency: 'AED',
  deliverables: '', collaborationType: '', reelStaysOnPage: false, contentForBrand: false,
  contactStatus: 'Not Contacted', discussionNotes: '', negotiationNotes: '',
  offerShared: false, approvalNotes: '', rejectionNotes: '', followUpReminder: '',
  bankName: '', accountTitle: '', iban: '', paymentMethod: '', paymentNotes: '',
  workflowStatus: 'New Lead', approvalStatus: 'Pending', paymentStatus: 'Not Requested', assignedTo: '',
  shootDate: '', shootTime: '', shootLocation: '', campaign: '',
  agreementStatus: 'Not Generated',
  insightsImageKeys: [],
}

/* ─── Field atoms — module-level (stable identity, no focus loss) ── */

/** Icon + input row, matches reference FuturisticField exactly */
function FInput({ icon: Icon, label, value, onChange, placeholder, type = 'text', readOnly = false }) {
  return (
    <div className="aif-field">
      <label className="aif-field-label">{label}</label>
      <div className="aif-field-outer">
        <div className="aif-field-inner">
          {Icon && <div className="aif-field-icon"><Icon size={14} /></div>}
          <input
            className="aif-field-ctrl"
            type={type}
            value={value || ''}
            onChange={e => !readOnly && onChange(e.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
          />
        </div>
      </div>
    </div>
  )
}

/** Icon + select row */
function FSelect({ icon: Icon, label, value, onChange, options, readOnly = false }) {
  return (
    <div className="aif-field">
      <label className="aif-field-label">{label}</label>
      <div className="aif-field-outer">
        <div className="aif-field-inner">
          {Icon && <div className="aif-field-icon"><Icon size={14} /></div>}
          <select
            className="aif-field-ctrl aif-field-ctrl--sel"
            value={value || ''}
            onChange={e => !readOnly && onChange(e.target.value)}
            disabled={readOnly}
          >
            {options.map(o =>
              typeof o === 'string'
                ? <option key={o} value={o}>{o || '— select —'}</option>
                : <option key={o.value} value={o.value}>{o.label}</option>
            )}
          </select>
        </div>
      </div>
    </div>
  )
}

/** Instagram live preview card shown in the Social step */
function InstagramPreviewCard({ handle, storedPicUrl }) {
  const [visible, setVisible] = useState(false)
  const [imgError, setImgError] = useState(false)
  const username = handle ? handle.replace(/^@/, '').trim() : ''

  useEffect(() => {
    setImgError(false)
    setVisible(false)
    if (!username) return
    const t = setTimeout(() => setVisible(true), 600)
    return () => clearTimeout(t)
  }, [username])

  if (!username || !visible) return null

  const profileUrl = `https://www.instagram.com/${username}/`
  const avatarSrc = storedPicUrl || resolveApiUrl(`/api/instagram-proxy/avatar/${encodeURIComponent(username)}`)

  return (
    <div className="aif-ig-preview">
      <p className="aif-ig-preview__label">Instagram Preview</p>
      <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="ig-profile-card">
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
          <span className="ig-profile-card__cta">View on Instagram ↗</span>
        </div>
        <div className="ig-profile-card__logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="ig-grad-wiz" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#f09433"/>
                <stop offset="25%" stopColor="#e6683c"/>
                <stop offset="50%" stopColor="#dc2743"/>
                <stop offset="75%" stopColor="#cc2366"/>
                <stop offset="100%" stopColor="#bc1888"/>
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig-grad-wiz)"/>
            <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="1.8" fill="none"/>
            <circle cx="17.5" cy="6.5" r="1.2" fill="white"/>
          </svg>
        </div>
      </a>
    </div>
  )
}

/** Textarea — wider outer radius matching reference */
function FTextarea({ label, value, onChange, placeholder, rows = 5, readOnly = false }) {
  return (
    <div className="aif-field aif-field--wide">
      <label className="aif-field-label">{label}</label>
      <div className="aif-ta-outer">
        <textarea
          className="aif-ta-ctrl"
          value={value || ''}
          onChange={e => !readOnly && onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          readOnly={readOnly}
        />
      </div>
    </div>
  )
}

/** Toggle switch */
function FToggle({ label, value, onChange, readOnly = false }) {
  return (
    <label className="aif-toggle-row">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        className={`aif-toggle${value ? ' is-on' : ''}`}
        disabled={readOnly}
        onClick={() => !readOnly && onChange(!value)}
      >
        <span className="aif-toggle-thumb" />
      </button>
      <span className="aif-toggle-label">{label}</span>
    </label>
  )
}

/** Section divider title */
function STitle({ children }) {
  return <h3 className="aif-section-title">{children}</h3>
}

/* ─── Main component ──────────────────────────────────────── */
export function AddInfluencerPage({ asModal = false, onClose }) {
  const { influencers, addInfluencer, updateInfluencer } = useInfluencers()
  const { user } = useAuth()
  const canInfl = (action) => hasPermission(user, 'influencers', action)
  const navigate = useNavigate()
  const { id }   = useParams()
  const isEdit   = Boolean(id)
  const existing = isEdit ? influencers.find(i => i.id === id) : null

  const [form, setForm] = useState(() =>
    existing
      ? { ...EMPTY_FORM, ...existing,
          instagram: existing.instagram || { handle: '', url: '' },
          youtube:   existing.youtube   || { handle: '', url: '' },
          tiktok:    existing.tiktok    || { handle: '', url: '' },
        }
      : EMPTY_FORM
  )
  const [saved, setSaved] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const canWrite = isEdit
    ? (canInfl('manage') || canInfl('approve'))
    : canInfl('manage')
  const ro = !canWrite

  const set       = (key, val)       => {
    setSubmitError('')
    setForm(f => ({ ...f, [key]: val }))
  }
  const setNested = (key, sub, val)  => {
    setSubmitError('')
    setForm(f => ({ ...f, [key]: { ...f[key], [sub]: val } }))
  }
  const cancel    = ()               => { if (asModal) onClose?.(); else navigate(-1) }
  const goToList  = ()               => { if (asModal) onClose?.(); navigate('/influencers/list') }

  const submit = async () => {
    if (isSubmitting) return
    setSubmitError('')
    if (!form.name?.trim()) {
      setSubmitError('Influencer name is required before creating a profile.')
      try {
        document.getElementById('aif-section-basic')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch (_) {}
      return
    }
    setIsSubmitting(true)
    try {
      if (isEdit) {
        const live = influencers.find((i) => String(i.id) === String(id))
        await updateInfluencer(id, {
          ...form,
          id,
          /** Always use the latest S3 key list from context (wizard form is often stale after insights uploads). */
          insightsImageKeys: live?.insightsImageKeys ?? form.insightsImageKeys ?? [],
        })
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      } else {
        const newId = await addInfluencer(form)
        if (asModal) onClose?.()
        else navigate(`/influencers/${newId}/edit`)
      }
    } catch (err) {
      setSubmitError(err?.message || 'Could not save profile. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const formSections = () => (
    <>
      <div className="aif-form-section" id="aif-section-basic">
        <STitle>Identity &amp; Contact</STitle>
        <div className="aif-row2">
          <FInput readOnly={ro} icon={User}       label="Influencer Name *" value={form.name}        onChange={v => set('name', v)}        placeholder="Full name" />
          <FInput readOnly={ro} icon={Sparkles}   label="Niche / Category"  value={form.niche}       onChange={v => set('niche', v)}       placeholder="Fashion, Beauty, Food…" />
          <FInput readOnly={ro} icon={Smartphone} label="Mobile Number"     value={form.mobile}      onChange={v => set('mobile', v)}      placeholder="+971 50 000 0000" />
          <FInput readOnly={ro} icon={Smartphone} label="WhatsApp Number"   value={form.whatsapp}    onChange={v => set('whatsapp', v)}    placeholder="+971 50 000 0000" />
          <FInput readOnly={ro} icon={Mail}       label="Email Address"     value={form.email}       onChange={v => set('email', v)}       placeholder="name@example.com" type="email" />
          <FInput readOnly={ro} icon={Globe2}     label="Nationality"       value={form.nationality} onChange={v => set('nationality', v)} placeholder="e.g. Emirati, Lebanese" />
          <FInput readOnly={ro} icon={MapPin}     label="Based In"          value={form.basedIn}     onChange={v => set('basedIn', v)}     placeholder="e.g. Dubai, Abu Dhabi" />
        </div>
        <FTextarea readOnly={ro} label="Notes / Intelligence" value={form.notes} onChange={v => set('notes', v)}
          placeholder="Strategic notes, communication preferences, past campaign performance…" rows={6} />
      </div>

      <div className="aif-form-section" id="aif-section-social">
        <STitle>Handles &amp; Profile URLs</STitle>
        <div className="aif-row2">
          <FInput readOnly={ro} icon={Camera}        label="Instagram Handle"  value={form.instagram?.handle} onChange={v => setNested('instagram', 'handle', v)} placeholder="@handle" />
          <FInput readOnly={ro} icon={Link2}         label="Instagram URL"     value={form.instagram?.url}    onChange={v => setNested('instagram', 'url', v)}    placeholder="https://instagram.com/…" />
          <FInput readOnly={ro} icon={Camera}        label="Instagram Profile Pic URL (optional)" value={form.instagram?.picUrl} onChange={v => setNested('instagram', 'picUrl', v)} placeholder="Paste direct image URL for profile pic" />
        </div>
        <InstagramPreviewCard handle={form.instagram?.handle} storedPicUrl={form.instagram?.picUrl} />
        <div className="aif-row2">
          <FInput readOnly={ro} icon={Video}         label="YouTube Handle"    value={form.youtube?.handle}   onChange={v => setNested('youtube', 'handle', v)}   placeholder="Channel name" />
          <FInput readOnly={ro} icon={Link2}         label="YouTube URL"       value={form.youtube?.url}      onChange={v => setNested('youtube', 'url', v)}      placeholder="https://youtube.com/@…" />
          <FInput readOnly={ro} icon={Hash}          label="TikTok Handle"     value={form.tiktok?.handle}    onChange={v => setNested('tiktok', 'handle', v)}    placeholder="@handle" />
          <FInput readOnly={ro} icon={Link2}         label="TikTok URL"        value={form.tiktok?.url}       onChange={v => setNested('tiktok', 'url', v)}       placeholder="https://tiktok.com/@…" />
          <FInput readOnly={ro} icon={Hash}          label="Snapchat Handle"   value={form.snapchat}          onChange={v => set('snapchat', v)}               placeholder="username" />
          <FInput readOnly={ro} icon={Share2}        label="Facebook Page"     value={form.facebook}          onChange={v => set('facebook', v)}               placeholder="Page name or URL" />
          <FInput readOnly={ro} icon={AtSign}        label="X / Twitter"       value={form.twitter}           onChange={v => set('twitter', v)}                placeholder="@handle" />
          <FInput readOnly={ro} icon={MessageCircle} label="Telegram"          value={form.telegram}          onChange={v => set('telegram', v)}               placeholder="@username or channel" />
          <FInput readOnly={ro} icon={Link2}         label="Website"           value={form.website}           onChange={v => set('website', v)}                placeholder="https://…" />
          <FInput readOnly={ro} icon={Hash}          label="Other Socials"     value={form.otherSocial}       onChange={v => set('otherSocial', v)}            placeholder="LinkedIn, Pinterest…" />
        </div>
      </div>

      <div className="aif-form-section" id="aif-section-audience">
        <STitle>Audience Metrics</STitle>
        <div className="aif-row2">
          <FInput readOnly={ro} icon={Users}      label="Followers Count"  value={form.followersCount}  onChange={v => set('followersCount', v)}  placeholder="e.g. 125,000" />
          <FInput readOnly={ro} icon={TrendingUp} label="Engagement Rate"  value={form.engagementRate}  onChange={v => set('engagementRate', v)}  placeholder="e.g. 4.2%" />
          <FInput readOnly={ro} icon={Eye}        label="Avg Reel Views"   value={form.avgReelViews}    onChange={v => set('avgReelViews', v)}    placeholder="e.g. 80,000" />
          <FInput readOnly={ro} icon={BarChart2}  label="Avg Story Reach"  value={form.avgStoryReach}   onChange={v => set('avgStoryReach', v)}   placeholder="e.g. 15,000" />
        </div>
        <FTextarea readOnly={ro} label="Audience Location Notes" value={form.audienceNotes} onChange={v => set('audienceNotes', v)}
          placeholder="e.g. Mainly UAE-based, 65% female, high engagement in Dubai…" rows={3} />
        <div className="aif-toggles">
          <FToggle readOnly={ro} label="Insights screenshots / data received" value={form.insightsReceived} onChange={v => set('insightsReceived', v)} />
        </div>
        {isEdit && id ? (
          <>
            <STitle>Insights images</STitle>
            <InsightsImagesSection
              influencerId={id}
              imageKeys={existing?.insightsImageKeys ?? []}
              canEdit={canInfl('manage') || canInfl('approve')}
              updateInfluencer={updateInfluencer}
              className="aif-insights-embed"
            />
          </>
        ) : (
          <p className="aif-insights-wizard-hint">
            Save the profile once, then you can add up to 6 insights screenshots here.
          </p>
        )}
      </div>

      <div className="aif-form-section" id="aif-section-commercial">
        <STitle>Pricing &amp; Deliverables</STitle>
        <div className="aif-row3">
          <FSelect readOnly={ro} icon={DollarSign} label="Currency"           value={form.currency}          onChange={v => set('currency', v)}          options={CURRENCIES} />
          <FInput readOnly={ro}  icon={DollarSign} label="Reels Price"        value={form.reelsPrice}        onChange={v => set('reelsPrice', v)}        placeholder="0" type="number" />
          <FInput readOnly={ro}  icon={DollarSign} label="Stories Price"      value={form.storiesPrice}      onChange={v => set('storiesPrice', v)}      placeholder="0" type="number" />
          <FInput readOnly={ro}  icon={DollarSign} label="Package Price"      value={form.packagePrice}      onChange={v => set('packagePrice', v)}      placeholder="0" type="number" />
          <FSelect readOnly={ro} icon={Sparkles}   label="Collaboration Type" value={form.collaborationType} onChange={v => set('collaborationType', v)} options={['', ...COLLABORATION_TYPES]} />
        </div>
        <FTextarea readOnly={ro} label="Deliverables" value={form.deliverables} onChange={v => set('deliverables', v)}
          placeholder="e.g. 1 Reel + 3 Stories on influencer page, usage rights included…" rows={3} />
        <div className="aif-toggles">
          <FToggle readOnly={ro} label="Reel stays permanently on influencer's channel" value={form.reelStaysOnPage} onChange={v => set('reelStaysOnPage', v)} />
          <FToggle readOnly={ro} label="Content production for brand channel included"  value={form.contentForBrand} onChange={v => set('contentForBrand', v)} />
        </div>
      </div>

      <div className="aif-form-section" id="aif-section-contact">
        <STitle>Negotiation &amp; Follow-up</STitle>
        <div className="aif-row2">
          <FSelect readOnly={ro} icon={Phone}    label="Contact Status"     value={form.contactStatus}    onChange={v => set('contactStatus', v)}    options={CONTACT_STATUSES} />
          <FInput readOnly={ro}  icon={Calendar} label="Follow-up Reminder" value={form.followUpReminder} onChange={v => set('followUpReminder', v)} type="date" />
        </div>
        <div className="aif-stack">
          <FTextarea readOnly={ro} label="Discussion Notes"        value={form.discussionNotes}  onChange={v => set('discussionNotes', v)}  placeholder="Key points from initial discussions…"   rows={3} />
          <FTextarea readOnly={ro} label="Price Negotiation Notes" value={form.negotiationNotes} onChange={v => set('negotiationNotes', v)} placeholder="Pricing discussion and counter-offers…" rows={3} />
          <FTextarea readOnly={ro} label="Approval Notes"          value={form.approvalNotes}    onChange={v => set('approvalNotes', v)}    placeholder="Why approved — key considerations…"      rows={2} />
          <FTextarea readOnly={ro} label="Rejection Notes"         value={form.rejectionNotes}   onChange={v => set('rejectionNotes', v)}   placeholder="Reason for rejection (if applicable)…"  rows={2} />
        </div>
        <div className="aif-toggles">
          <FToggle readOnly={ro} label="Offer / brief has been shared with influencer" value={form.offerShared} onChange={v => set('offerShared', v)} />
        </div>
      </div>

      <div className="aif-form-section" id="aif-section-payment">
        <STitle>Bank &amp; Payment Details</STitle>
        <div className="aif-row2">
          <FInput readOnly={ro}  icon={Building2}  label="Bank Name"          value={form.bankName}      onChange={v => set('bankName', v)}      placeholder="e.g. Emirates NBD" />
          <FInput readOnly={ro}  icon={User}       label="Account Title"      value={form.accountTitle}  onChange={v => set('accountTitle', v)}  placeholder="Account holder name" />
          <FInput readOnly={ro}  icon={CreditCard} label="IBAN / Account No." value={form.iban}          onChange={v => set('iban', v)}          placeholder="AE…" />
          <FSelect readOnly={ro} icon={CreditCard} label="Payment Method"     value={form.paymentMethod} onChange={v => set('paymentMethod', v)} options={['', 'Bank Transfer', 'Cash', 'Cheque', 'Online Transfer', 'Other']} />
        </div>
        <FTextarea readOnly={ro} label="Payment Notes" value={form.paymentNotes} onChange={v => set('paymentNotes', v)}
          placeholder="Any notes for the finance team…" rows={3} />
      </div>

      <div className="aif-form-section" id="aif-section-status">
        <STitle>Workflow &amp; Assignment</STitle>
        <div className="aif-row2">
          <FSelect readOnly={ro} icon={BadgeCheck} label="Workflow Stage"   value={form.workflowStatus}  onChange={v => set('workflowStatus', v)}  options={WORKFLOW_STAGES} />
          <FSelect readOnly={ro} icon={BadgeCheck} label="Approval Status"  value={form.approvalStatus}  onChange={v => set('approvalStatus', v)}  options={APPROVAL_STATUSES} />
          <FSelect readOnly={ro} icon={CreditCard} label="Payment Status"   value={form.paymentStatus}   onChange={v => set('paymentStatus', v)}   options={PAYMENT_STATUSES} />
          <FInput readOnly={ro}  icon={User}       label="Assigned To"      value={form.assignedTo}      onChange={v => set('assignedTo', v)}      placeholder="Team member name" />
        </div>
        <STitle>Shoot Details</STitle>
        <div className="aif-row2">
          <FInput readOnly={ro} icon={Calendar} label="Shoot Date"      value={form.shootDate}     onChange={v => set('shootDate', v)}     type="date" />
          <FInput readOnly={ro} icon={Clock}    label="Shoot Time"      value={form.shootTime}     onChange={v => set('shootTime', v)}     type="time" />
          <FInput readOnly={ro} icon={MapPin}   label="Shoot Location"  value={form.shootLocation} onChange={v => set('shootLocation', v)} placeholder="Studio, store address…" />
          <FInput readOnly={ro} icon={FileText} label="Campaign / Offer" value={form.campaign}     onChange={v => set('campaign', v)}      placeholder="Campaign name or offer" />
        </div>
      </div>
    </>
  )

  /* ─── Rendered page content ─── */
  const content = (
    <div className="aif-page">

      {/* Background orbs — match page gradient directions */}
      <div className="aif-bg-orb aif-bg-orb--tl" aria-hidden="true" />
      <div className="aif-bg-orb aif-bg-orb--tr" aria-hidden="true" />
      <div className="aif-bg-orb aif-bg-orb--bc" aria-hidden="true" />

      <div className="aif-content">

        {/* ── Top bar ── */}
        <header className="aif-topbar">
          <div className="aif-topbar__text">
            <div className="aif-back-row">
              <button
                type="button"
                className="inf-hero__back-btn"
                onClick={goToList}
                aria-label="Back to influencer list"
              >
                <List size={16} strokeWidth={2.25} aria-hidden />
                Back to list
              </button>
            </div>
            <div className="aif-eyebrow">
              <Sparkles size={11} />
              Influencer Intelligence System
            </div>
            <h1 className="aif-title">
              {isEdit ? 'Edit Influencer' : 'Add Influencer'}
            </h1>
            <p className="aif-subtitle">
              {isEdit
                ? `Update every section below in one place · ${existing?.name || ''}`.trim()
                : 'Fill in each section on this page — no step tabs, scroll to review before saving.'}
            </p>
          </div>

          <div className="aif-topbar__actions">
            <button type="button" className="aif-btn-ghost" onClick={cancel}>
              <X size={14} /> Cancel
            </button>
            <button type="button" className="aif-btn-primary" onClick={submit} disabled={!canWrite || isSubmitting}>
              {isSubmitting
                ? 'Saving...'
                : saved
                  ? <><CheckCircle2 size={14} /> Saved</>
                  : isEdit
                    ? 'Save Changes'
                    : 'Create Profile'}
            </button>
          </div>
        </header>
        {submitError ? (
          <div
            role="alert"
            style={{
              marginTop: '0.75rem',
              marginBottom: '0.25rem',
              color: '#b91c1c',
              fontWeight: 600,
              fontSize: '0.92rem',
            }}
          >
            {submitError}
          </div>
        ) : null}

        <div className="aif-layout aif-layout--single">
          <section className="aif-panel aif-panel--stacked">
            <div className="aif-panel__grad" aria-hidden="true" />
            <div className="aif-panel__orb aif-panel__orb--tr" aria-hidden="true" />
            <div className="aif-panel__orb aif-panel__orb--bl" aria-hidden="true" />
            <div className="aif-panel__body aif-panel__body--longform">
              {formSections()}
            </div>
            <footer className="aif-panel__footer aif-panel__footer--end">
              <div className="aif-panel__footer-btns" style={{ width: '100%', justifyContent: 'flex-end' }}>
                <button type="button" className="aif-btn-primary" onClick={submit} disabled={!canWrite || isSubmitting}>
                  {isSubmitting
                    ? 'Saving...'
                    : saved
                      ? <><CheckCircle2 size={14} /> Saved</>
                      : isEdit
                        ? 'Save changes'
                        : 'Create profile'}
                </button>
              </div>
            </footer>
          </section>
        </div>
      </div>
    </div>
  )

  if (asModal) {
    return (
      <div className="inf-modal-overlay" onClick={cancel}>
        <div className="aif-modal-wrap" onClick={e => e.stopPropagation()}>
          {content}
        </div>
      </div>
    )
  }

  return content
}
