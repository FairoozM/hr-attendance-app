import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { resolveApiUrl } from '../../api/client'
import {
  User, Smartphone, Mail, Globe2, MapPin, Sparkles, ChevronRight,
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

const STEPS = [
  { id: 'basic',      label: 'Basic Details',          Icon: User },
  { id: 'social',     label: 'Social Media',           Icon: Camera },
  { id: 'audience',   label: 'Audience & Profile',     Icon: Users },
  { id: 'commercial', label: 'Commercial',             Icon: DollarSign },
  { id: 'contact',    label: 'Contact & Negotiation',  Icon: MessageCircle },
  { id: 'payment',    label: 'Payment Details',        Icon: CreditCard },
  { id: 'status',     label: 'Status & Assign',        Icon: BadgeCheck },
]

/* ─── Field atoms — module-level (stable identity, no focus loss) ── */

/** Icon + input row, matches reference FuturisticField exactly */
function FInput({ icon: Icon, label, value, onChange, placeholder, type = 'text' }) {
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
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
          />
        </div>
      </div>
    </div>
  )
}

/** Icon + select row */
function FSelect({ icon: Icon, label, value, onChange, options }) {
  return (
    <div className="aif-field">
      <label className="aif-field-label">{label}</label>
      <div className="aif-field-outer">
        <div className="aif-field-inner">
          {Icon && <div className="aif-field-icon"><Icon size={14} /></div>}
          <select
            className="aif-field-ctrl aif-field-ctrl--sel"
            value={value || ''}
            onChange={e => onChange(e.target.value)}
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
function FTextarea({ label, value, onChange, placeholder, rows = 5 }) {
  return (
    <div className="aif-field aif-field--wide">
      <label className="aif-field-label">{label}</label>
      <div className="aif-ta-outer">
        <textarea
          className="aif-ta-ctrl"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
        />
      </div>
    </div>
  )
}

/** Toggle switch */
function FToggle({ label, value, onChange }) {
  return (
    <label className="aif-toggle-row">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        className={`aif-toggle${value ? ' is-on' : ''}`}
        onClick={() => onChange(!value)}
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
  const [step,  setStep]  = useState(0)
  const [saved, setSaved] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

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
      setStep(0)
      setSubmitError('Influencer name is required before creating a profile.')
      return
    }
    setIsSubmitting(true)
    try {
      if (isEdit) {
        await updateInfluencer(id, form)
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      } else {
        const newId = await addInfluencer(form)
        if (asModal) onClose?.()
        else navigate(`/influencers/${newId}`)
      }
    } catch (err) {
      setSubmitError(err?.message || 'Could not save profile. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const cur  = STEPS[step]
  const SIcon = cur.Icon
  const pct  = Math.round(((step + 1) / STEPS.length) * 100)

  /* ─── Section form bodies ─── */
  const body = () => {
    switch (cur.id) {

      case 'basic': return (
        <>
          <STitle>Identity &amp; Contact</STitle>
          <div className="aif-row2">
            <FInput icon={User}       label="Influencer Name *" value={form.name}        onChange={v => set('name', v)}        placeholder="Full name" />
            <FInput icon={Sparkles}   label="Niche / Category"  value={form.niche}       onChange={v => set('niche', v)}       placeholder="Fashion, Beauty, Food…" />
            <FInput icon={Smartphone} label="Mobile Number"     value={form.mobile}      onChange={v => set('mobile', v)}      placeholder="+971 50 000 0000" />
            <FInput icon={Smartphone} label="WhatsApp Number"   value={form.whatsapp}    onChange={v => set('whatsapp', v)}    placeholder="+971 50 000 0000" />
            <FInput icon={Mail}       label="Email Address"     value={form.email}       onChange={v => set('email', v)}       placeholder="name@example.com" type="email" />
            <FInput icon={Globe2}     label="Nationality"       value={form.nationality} onChange={v => set('nationality', v)} placeholder="e.g. Emirati, Lebanese" />
            <FInput icon={MapPin}     label="Based In"          value={form.basedIn}     onChange={v => set('basedIn', v)}     placeholder="e.g. Dubai, Abu Dhabi" />
          </div>
          <FTextarea label="Notes / Intelligence" value={form.notes} onChange={v => set('notes', v)}
            placeholder="Strategic notes, communication preferences, past campaign performance…" rows={6} />
        </>
      )

      case 'social': return (
        <>
          <STitle>Handles &amp; Profile URLs</STitle>
          <div className="aif-row2">
            <FInput icon={Camera}        label="Instagram Handle"  value={form.instagram?.handle} onChange={v => setNested('instagram','handle',v)} placeholder="@handle" />
            <FInput icon={Link2}         label="Instagram URL"     value={form.instagram?.url}    onChange={v => setNested('instagram','url',v)}    placeholder="https://instagram.com/…" />
            <FInput icon={Camera}        label="Instagram Profile Pic URL (optional)" value={form.instagram?.picUrl} onChange={v => setNested('instagram','picUrl',v)} placeholder="Paste direct image URL for profile pic" />
          </div>
          <InstagramPreviewCard handle={form.instagram?.handle} storedPicUrl={form.instagram?.picUrl} />
          <div className="aif-row2">
            <FInput icon={Video}         label="YouTube Handle"    value={form.youtube?.handle}   onChange={v => setNested('youtube','handle',v)}   placeholder="Channel name" />
            <FInput icon={Link2}         label="YouTube URL"       value={form.youtube?.url}      onChange={v => setNested('youtube','url',v)}      placeholder="https://youtube.com/@…" />
            <FInput icon={Hash}          label="TikTok Handle"     value={form.tiktok?.handle}    onChange={v => setNested('tiktok','handle',v)}    placeholder="@handle" />
            <FInput icon={Link2}         label="TikTok URL"        value={form.tiktok?.url}       onChange={v => setNested('tiktok','url',v)}       placeholder="https://tiktok.com/@…" />
            <FInput icon={Hash}          label="Snapchat Handle"   value={form.snapchat}          onChange={v => set('snapchat', v)}               placeholder="username" />
            <FInput icon={Share2}        label="Facebook Page"     value={form.facebook}          onChange={v => set('facebook', v)}               placeholder="Page name or URL" />
            <FInput icon={AtSign}        label="X / Twitter"       value={form.twitter}           onChange={v => set('twitter', v)}                placeholder="@handle" />
            <FInput icon={MessageCircle} label="Telegram"          value={form.telegram}          onChange={v => set('telegram', v)}               placeholder="@username or channel" />
            <FInput icon={Link2}         label="Website"           value={form.website}           onChange={v => set('website', v)}                placeholder="https://…" />
            <FInput icon={Hash}          label="Other Socials"     value={form.otherSocial}       onChange={v => set('otherSocial', v)}            placeholder="LinkedIn, Pinterest…" />
          </div>
        </>
      )

      case 'audience': return (
        <>
          <STitle>Audience Metrics</STitle>
          <div className="aif-row2">
            <FInput icon={Users}      label="Followers Count"  value={form.followersCount}  onChange={v => set('followersCount', v)}  placeholder="e.g. 125,000" />
            <FInput icon={TrendingUp} label="Engagement Rate"  value={form.engagementRate}  onChange={v => set('engagementRate', v)}  placeholder="e.g. 4.2%" />
            <FInput icon={Eye}        label="Avg Reel Views"   value={form.avgReelViews}    onChange={v => set('avgReelViews', v)}    placeholder="e.g. 80,000" />
            <FInput icon={BarChart2}  label="Avg Story Reach"  value={form.avgStoryReach}   onChange={v => set('avgStoryReach', v)}   placeholder="e.g. 15,000" />
          </div>
          <FTextarea label="Audience Location Notes" value={form.audienceNotes} onChange={v => set('audienceNotes', v)}
            placeholder="e.g. Mainly UAE-based, 65% female, high engagement in Dubai…" rows={3} />
          <div className="aif-toggles">
            <FToggle label="Insights screenshots / data received" value={form.insightsReceived} onChange={v => set('insightsReceived', v)} />
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
              Save the profile once to enable uploads. After creation, reopen this influencer or go to their profile to add up to 6 insights screenshots (same storage as the profile page).
            </p>
          )}
        </>
      )

      case 'commercial': return (
        <>
          <STitle>Pricing &amp; Deliverables</STitle>
          <div className="aif-row3">
            <FSelect icon={DollarSign} label="Currency"           value={form.currency}          onChange={v => set('currency', v)}          options={CURRENCIES} />
            <FInput  icon={DollarSign} label="Reels Price"        value={form.reelsPrice}        onChange={v => set('reelsPrice', v)}        placeholder="0" type="number" />
            <FInput  icon={DollarSign} label="Stories Price"      value={form.storiesPrice}      onChange={v => set('storiesPrice', v)}      placeholder="0" type="number" />
            <FInput  icon={DollarSign} label="Package Price"      value={form.packagePrice}      onChange={v => set('packagePrice', v)}      placeholder="0" type="number" />
            <FSelect icon={Sparkles}   label="Collaboration Type" value={form.collaborationType} onChange={v => set('collaborationType', v)} options={['', ...COLLABORATION_TYPES]} />
          </div>
          <FTextarea label="Deliverables" value={form.deliverables} onChange={v => set('deliverables', v)}
            placeholder="e.g. 1 Reel + 3 Stories on influencer page, usage rights included…" rows={3} />
          <div className="aif-toggles">
            <FToggle label="Reel stays permanently on influencer's channel" value={form.reelStaysOnPage} onChange={v => set('reelStaysOnPage', v)} />
            <FToggle label="Content production for brand channel included"  value={form.contentForBrand} onChange={v => set('contentForBrand', v)} />
          </div>
        </>
      )

      case 'contact': return (
        <>
          <STitle>Negotiation &amp; Follow-up</STitle>
          <div className="aif-row2">
            <FSelect icon={Phone}    label="Contact Status"     value={form.contactStatus}    onChange={v => set('contactStatus', v)}    options={CONTACT_STATUSES} />
            <FInput  icon={Calendar} label="Follow-up Reminder" value={form.followUpReminder} onChange={v => set('followUpReminder', v)} type="date" />
          </div>
          <div className="aif-stack">
            <FTextarea label="Discussion Notes"        value={form.discussionNotes}  onChange={v => set('discussionNotes', v)}  placeholder="Key points from initial discussions…"   rows={3} />
            <FTextarea label="Price Negotiation Notes" value={form.negotiationNotes} onChange={v => set('negotiationNotes', v)} placeholder="Pricing discussion and counter-offers…" rows={3} />
            <FTextarea label="Approval Notes"          value={form.approvalNotes}    onChange={v => set('approvalNotes', v)}    placeholder="Why approved — key considerations…"      rows={2} />
            <FTextarea label="Rejection Notes"         value={form.rejectionNotes}   onChange={v => set('rejectionNotes', v)}   placeholder="Reason for rejection (if applicable)…"  rows={2} />
          </div>
          <div className="aif-toggles">
            <FToggle label="Offer / brief has been shared with influencer" value={form.offerShared} onChange={v => set('offerShared', v)} />
          </div>
        </>
      )

      case 'payment': return (
        <>
          <STitle>Bank &amp; Payment Details</STitle>
          <div className="aif-row2">
            <FInput  icon={Building2}  label="Bank Name"          value={form.bankName}      onChange={v => set('bankName', v)}      placeholder="e.g. Emirates NBD" />
            <FInput  icon={User}       label="Account Title"      value={form.accountTitle}  onChange={v => set('accountTitle', v)}  placeholder="Account holder name" />
            <FInput  icon={CreditCard} label="IBAN / Account No." value={form.iban}          onChange={v => set('iban', v)}          placeholder="AE…" />
            <FSelect icon={CreditCard} label="Payment Method"     value={form.paymentMethod} onChange={v => set('paymentMethod', v)} options={['', 'Bank Transfer', 'Cash', 'Cheque', 'Online Transfer', 'Other']} />
          </div>
          <FTextarea label="Payment Notes" value={form.paymentNotes} onChange={v => set('paymentNotes', v)}
            placeholder="Any notes for the finance team…" rows={3} />
        </>
      )

      case 'status': return (
        <>
          <STitle>Workflow &amp; Assignment</STitle>
          <div className="aif-row2">
            <FSelect icon={BadgeCheck} label="Workflow Stage"   value={form.workflowStatus}  onChange={v => set('workflowStatus', v)}  options={WORKFLOW_STAGES} />
            <FSelect icon={BadgeCheck} label="Approval Status"  value={form.approvalStatus}  onChange={v => set('approvalStatus', v)}  options={APPROVAL_STATUSES} />
            <FSelect icon={CreditCard} label="Payment Status"   value={form.paymentStatus}   onChange={v => set('paymentStatus', v)}   options={PAYMENT_STATUSES} />
            <FInput  icon={User}       label="Assigned To"      value={form.assignedTo}      onChange={v => set('assignedTo', v)}      placeholder="Team member name" />
          </div>
          <STitle>Shoot Details</STitle>
          <div className="aif-row2">
            <FInput icon={Calendar} label="Shoot Date"      value={form.shootDate}     onChange={v => set('shootDate', v)}     type="date" />
            <FInput icon={Clock}    label="Shoot Time"      value={form.shootTime}     onChange={v => set('shootTime', v)}     type="time" />
            <FInput icon={MapPin}   label="Shoot Location"  value={form.shootLocation} onChange={v => set('shootLocation', v)} placeholder="Studio, store address…" />
            <FInput icon={FileText} label="Campaign / Offer" value={form.campaign}     onChange={v => set('campaign', v)}      placeholder="Campaign name or offer" />
          </div>
        </>
      )

      default: return null
    }
  }

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
                ? `Editing profile · ${existing?.name}`
                : 'Create a next-generation influencer profile with precision and elegance.'}
            </p>
          </div>

          <div className="aif-topbar__actions">
            <button type="button" className="aif-btn-ghost" onClick={cancel}>
              <X size={14} /> Cancel
            </button>
            <button type="button" className="aif-btn-primary" onClick={submit} disabled={isSubmitting}>
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

        {/* ── Two-column grid ── */}
        <div className="aif-layout">

          {/* ── Step sidebar ── */}
          <aside className="aif-sidebar">
            <div className="aif-sidebar__head">
              <p className="aif-sidebar__eyebrow">Workflow</p>
              <h2 className="aif-sidebar__title">Profile Builder</h2>
            </div>

            <div className="aif-steps">
              {STEPS.map((s, i) => {
                const active    = i === step
                const completed = i < step
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`aif-step${active ? ' is-active' : completed ? ' is-done' : ''}`}
                    onClick={() => setStep(i)}
                  >
                    <div className={`aif-step__num${active ? ' is-active' : completed ? ' is-done' : ''}`}>
                      {String(i + 1).padStart(2, '0')}
                    </div>
                    <div className="aif-step__text">
                      <p className="aif-step__label">{s.label}</p>
                      <p className="aif-step__hint">
                        {active ? 'Current section' : completed ? 'Completed' : 'Pending'}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>

          {/* ── Main glass panel ── */}
          <section className="aif-panel">

            {/* Depth decorations — inside the glass panel */}
            <div className="aif-panel__grad" aria-hidden="true" />
            <div className="aif-panel__orb aif-panel__orb--tr" aria-hidden="true" />
            <div className="aif-panel__orb aif-panel__orb--bl" aria-hidden="true" />

            {/* Panel header */}
            <div className="aif-panel__header">
              <div className="aif-panel__header-left">
                <div className="aif-panel__icon">
                  <SIcon size={20} />
                </div>
                <div>
                  <span className="aif-panel__step-pill">
                    Step {String(step + 1).padStart(2, '0')} / {STEPS.length}
                  </span>
                  <h2 className="aif-panel__title">{cur.label}</h2>
                  <p className="aif-panel__sub">
                    Build a refined, high-signal influencer profile with structured input.
                  </p>
                </div>
              </div>

              <div className="aif-pct-chip">
                <span className="aif-pct-chip__label">Completion</span>
                <span className="aif-pct-chip__val">{pct}%</span>
              </div>
            </div>

            {/* Panel body: form + overview */}
            <div className="aif-panel__body">
              <div className="aif-body-split">

                {/* Form fields */}
                <div className="aif-form-area">
                  {body()}
                </div>

                {/* Live overview */}
                <div className="aif-overview">
                  <p className="aif-overview__heading">Live Overview</p>

                  <div className="aif-overview__items">
                    {[
                      { label: 'Identity',   Icon: User },
                      { label: 'Reach',      Icon: TrendingUp },
                      { label: 'Commercial', Icon: DollarSign },
                      { label: 'Operations', Icon: CreditCard },
                    ].map(({ label, Icon: OIcon }) => (
                      <div key={label} className="aif-overview__item">
                        <div className="aif-overview__item-icon"><OIcon size={11} /></div>
                        <span className="aif-overview__item-label">{label}</span>
                      </div>
                    ))}
                  </div>

                  <div className="aif-overview__status">
                    <p className="aif-overview__status-title">Profile Status</p>
                    <p className="aif-overview__status-body">
                      {form.name
                        ? `Building profile for ${form.name}${form.instagram?.handle ? ` · ${form.instagram.handle}` : ''}`
                        : 'Enter influencer name to begin.'}
                    </p>
                  </div>

                  <div className="aif-overview__pills">
                    {STEPS.map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setStep(i)}
                        className={`aif-step-pill${i === step ? ' is-active' : i < step ? ' is-done' : ''}`}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            </div>

            {/* Panel footer */}
            <footer className="aif-panel__footer">
              <div className="aif-progress">
                <div className="aif-progress__track">
                  <div className="aif-progress__fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="aif-progress__pct">{pct}%</span>
              </div>

              <div className="aif-panel__footer-btns">
                {step > 0 && (
                  <button type="button" className="aif-btn-ghost"
                    onClick={() => setStep(i => Math.max(i - 1, 0))}>
                    Previous
                  </button>
                )}
                {step < STEPS.length - 1 ? (
                  <button type="button" className="aif-btn-next"
                    onClick={() => setStep(i => Math.min(i + 1, STEPS.length - 1))}>
                    Continue <ChevronRight size={14} />
                  </button>
                ) : (
                  <button type="button" className="aif-btn-primary" onClick={submit} disabled={isSubmitting}>
                    {isSubmitting
                      ? 'Saving...'
                      : saved
                        ? <><CheckCircle2 size={14} /> Saved</>
                        : isEdit
                          ? 'Save Changes'
                          : 'Create Profile'}
                  </button>
                )}
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
