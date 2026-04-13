import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  User, Smartphone, Mail, Globe2, MapPin, Sparkles, ChevronRight,
  Camera, Video, Hash, MessageCircle, Share2, AtSign,
  Users, TrendingUp, Eye, BarChart2, DollarSign, Link2,
  Phone, FileText, CreditCard, Building2, BadgeCheck, Calendar,
  Clock, X,
} from 'lucide-react'
import { useInfluencers, WORKFLOW_STAGES, APPROVAL_STATUSES, PAYMENT_STATUSES, COLLABORATION_TYPES, CONTACT_STATUSES, CURRENCIES } from '../../contexts/InfluencersContext'
import './influencers.css'

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
}

const SECTIONS = [
  { id: 'basic',      label: 'Basic Details',           icon: User },
  { id: 'social',     label: 'Social Media',            icon: Camera },
  { id: 'audience',   label: 'Audience & Profile',      icon: Users },
  { id: 'commercial', label: 'Commercial',              icon: DollarSign },
  { id: 'contact',    label: 'Contact & Negotiation',   icon: MessageCircle },
  { id: 'payment',    label: 'Payment Details',         icon: CreditCard },
  { id: 'status',     label: 'Status & Assign',         icon: BadgeCheck },
]

const OVERVIEW = [
  { title: 'Identity',    value: 'Core profile details' },
  { title: 'Reach',       value: 'Social & audience data' },
  { title: 'Commercial',  value: 'Rates & negotiation' },
  { title: 'Operations',  value: 'Payment & assignment' },
]

/* ─── Futuristic field atoms (defined at module level — no focus loss) ─── */
function FField({ label, icon: Icon, children }) {
  return (
    <div className="aif-field">
      <label className="aif-field__label">{label}</label>
      <div className="aif-field__wrap">
        <div className="aif-field__inner">
          {Icon && (
            <div className="aif-field__icon">
              <Icon size={15} />
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

function FInput({ icon, label, value, onChange, placeholder, type = 'text' }) {
  return (
    <FField label={label} icon={icon}>
      <input
        className="aif-field__input"
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </FField>
  )
}

function FSelect({ icon, label, value, onChange, options }) {
  return (
    <FField label={label} icon={icon}>
      <select
        className="aif-field__input aif-field__select"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(o => typeof o === 'string'
          ? <option key={o} value={o}>{o || '— select —'}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>
        )}
      </select>
    </FField>
  )
}

function FTextarea({ label, value, onChange, placeholder, rows = 5 }) {
  return (
    <div className="aif-field aif-field--full">
      <label className="aif-field__label">{label}</label>
      <div className="aif-field__wrap aif-field__wrap--textarea">
        <textarea
          className="aif-field__textarea"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
        />
      </div>
    </div>
  )
}

function FToggle({ label, value, onChange }) {
  return (
    <div className="aif-toggle-row">
      <button
        type="button"
        className={`aif-toggle ${value ? 'aif-toggle--on' : ''}`}
        onClick={() => onChange(!value)}
      >
        <span className="aif-toggle__thumb" />
      </button>
      <span className="aif-toggle__label">{label}</span>
    </div>
  )
}

/* ─── Main component ─── */
export function AddInfluencerPage({ asModal = false, onClose }) {
  const { influencers, addInfluencer, updateInfluencer } = useInfluencers()
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = Boolean(id)
  const existing = isEdit ? influencers.find(i => i.id === id) : null

  const [form, setForm] = useState(() => existing ? {
    ...EMPTY_FORM, ...existing,
    instagram: existing.instagram || { handle: '', url: '' },
    youtube:   existing.youtube   || { handle: '', url: '' },
    tiktok:    existing.tiktok    || { handle: '', url: '' },
  } : EMPTY_FORM)

  const [stepIdx, setStepIdx] = useState(0)
  const [saved, setSaved] = useState(false)

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const setNested = (key, sub, val) => setForm(f => ({ ...f, [key]: { ...f[key], [sub]: val } }))

  const handleCancel = () => { if (asModal) onClose?.(); else navigate(-1) }

  const handleSubmit = () => {
    if (!form.name?.trim()) { setStepIdx(0); return }
    if (isEdit) {
      updateInfluencer(id, form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      const newId = addInfluencer(form)
      if (asModal) onClose?.()
      else navigate(`/influencers/${newId}`)
    }
  }

  const activeSection = SECTIONS[stepIdx]
  const pct = Math.round(((stepIdx + 1) / SECTIONS.length) * 100)
  const SectionIcon = activeSection.icon

  const pageContent = (
    <div className="aif-root">
      {/* Top bar */}
      <div className="aif-topbar">
        <div className="aif-topbar__left">
          <div className="aif-topbar__badge">
            <Sparkles size={12} />
            Influencer Intelligence System
          </div>
          <h1 className="aif-topbar__title">{isEdit ? 'Edit Influencer' : 'Add Influencer'}</h1>
          <p className="aif-topbar__sub">
            {isEdit ? `Editing: ${existing?.name}` : 'Create a premium influencer profile with precision and elegance.'}
          </p>
        </div>
        <div className="aif-topbar__actions">
          <button type="button" className="aif-btn aif-btn--ghost" onClick={handleCancel}>
            <X size={15} /> Cancel
          </button>
          <button type="button" className="aif-btn aif-btn--primary" onClick={handleSubmit}>
            {saved ? '✓ Saved' : isEdit ? 'Save Changes' : 'Create Profile'}
          </button>
        </div>
      </div>

      {/* Layout */}
      <div className="aif-layout">

        {/* Sidebar steps */}
        <aside className="aif-steps">
          <div className="aif-steps__header">
            <p className="aif-steps__workflow-label">Workflow</p>
            <h2 className="aif-steps__workflow-title">Profile Builder</h2>
          </div>
          <div className="aif-steps__list">
            {SECTIONS.map((s, i) => {
              const StepIcon = s.icon
              const active = i === stepIdx
              const done = i < stepIdx
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`aif-step ${active ? 'aif-step--active' : done ? 'aif-step--done' : ''}`}
                  onClick={() => setStepIdx(i)}
                >
                  <div className={`aif-step__num ${active ? 'aif-step__num--active' : done ? 'aif-step__num--done' : ''}`}>
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <div className="aif-step__body">
                    <p className="aif-step__label">{s.label}</p>
                    <p className="aif-step__status">
                      {active ? 'Current section' : done ? 'Completed' : 'Pending'}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        {/* Main panel */}
        <section className="aif-panel">
          {/* Panel header */}
          <div className="aif-panel__header">
            <div className="aif-panel__header-left">
              <div className="aif-panel__icon">
                <SectionIcon size={22} />
              </div>
              <div>
                <div className="aif-panel__step-badge">
                  Step {String(stepIdx + 1).padStart(2, '0')} / {SECTIONS.length}
                </div>
                <h2 className="aif-panel__title">{activeSection.label}</h2>
                <p className="aif-panel__sub">Fill in the details for this section to build a complete profile.</p>
              </div>
            </div>
            <div className="aif-panel__completion">
              <p className="aif-panel__completion-label">Completion</p>
              <p className="aif-panel__completion-val">{pct}%</p>
            </div>
          </div>

          {/* Panel body */}
          <div className="aif-panel__body">
            <div className="aif-body-grid">
              {/* Form fields */}
              <div className="aif-body-grid__main">
                {activeSection.id === 'basic' && (
                  <>
                    <div className="aif-grid-2">
                      <FInput icon={User}       label="Influencer Name *" value={form.name}        onChange={v => set('name', v)}        placeholder="Full name" />
                      <FInput icon={Sparkles}   label="Niche / Category"  value={form.niche}       onChange={v => set('niche', v)}       placeholder="Fashion, Beauty, Food" />
                      <FInput icon={Smartphone} label="Mobile Number"     value={form.mobile}      onChange={v => set('mobile', v)}      placeholder="+971 50 xxx xxxx" />
                      <FInput icon={Smartphone} label="WhatsApp Number"   value={form.whatsapp}    onChange={v => set('whatsapp', v)}    placeholder="+971 50 xxx xxxx" />
                      <FInput icon={Mail}       label="Email Address"     value={form.email}       onChange={v => set('email', v)}       placeholder="name@example.com" type="email" />
                      <FInput icon={Globe2}     label="Nationality"       value={form.nationality} onChange={v => set('nationality', v)} placeholder="e.g. Emirati, Lebanese" />
                      <FInput icon={MapPin}     label="Based In"          value={form.basedIn}     onChange={v => set('basedIn', v)}     placeholder="e.g. Dubai, Abu Dhabi" />
                    </div>
                    <FTextarea label="Notes / Intelligence" value={form.notes} onChange={v => set('notes', v)}
                      placeholder="Add strategic notes, communication preferences, content fit, previous campaign performance..." rows={5} />
                  </>
                )}

                {activeSection.id === 'social' && (
                  <div className="aif-grid-2">
                    <FInput icon={Camera}         label="Instagram Handle"    value={form.instagram?.handle} onChange={v => setNested('instagram','handle',v)} placeholder="@handle" />
                    <FInput icon={Link2}          label="Instagram URL"       value={form.instagram?.url}    onChange={v => setNested('instagram','url',v)}    placeholder="https://instagram.com/..." />
                    <FInput icon={Video}          label="YouTube Handle"      value={form.youtube?.handle}   onChange={v => setNested('youtube','handle',v)}   placeholder="Channel name" />
                    <FInput icon={Link2}          label="YouTube URL"         value={form.youtube?.url}      onChange={v => setNested('youtube','url',v)}      placeholder="https://youtube.com/@..." />
                    <FInput icon={Hash}           label="TikTok Handle"       value={form.tiktok?.handle}    onChange={v => setNested('tiktok','handle',v)}    placeholder="@handle" />
                    <FInput icon={Link2}          label="TikTok URL"          value={form.tiktok?.url}       onChange={v => setNested('tiktok','url',v)}       placeholder="https://tiktok.com/@..." />
                    <FInput icon={Hash}           label="Snapchat Handle"     value={form.snapchat}          onChange={v => set('snapchat', v)}               placeholder="username" />
                    <FInput icon={Share2}         label="Facebook Handle"     value={form.facebook}          onChange={v => set('facebook', v)}               placeholder="Page name or URL" />
                    <FInput icon={AtSign}         label="X / Twitter"         value={form.twitter}           onChange={v => set('twitter', v)}                placeholder="@handle" />
                    <FInput icon={MessageCircle}  label="Telegram"            value={form.telegram}          onChange={v => set('telegram', v)}               placeholder="@username or channel" />
                    <FInput icon={Link2}          label="Website"             value={form.website}           onChange={v => set('website', v)}                placeholder="https://..." />
                    <FInput icon={Hash}           label="Other Social"        value={form.otherSocial}       onChange={v => set('otherSocial', v)}            placeholder="LinkedIn, Pinterest…" />
                  </div>
                )}

                {activeSection.id === 'audience' && (
                  <>
                    <div className="aif-grid-2">
                      <FInput icon={Users}      label="Followers Count"      value={form.followersCount}  onChange={v => set('followersCount', v)}  placeholder="e.g. 125,000" />
                      <FInput icon={TrendingUp} label="Engagement Rate"      value={form.engagementRate}  onChange={v => set('engagementRate', v)}  placeholder="e.g. 4.2%" />
                      <FInput icon={Eye}        label="Avg Reel Views"       value={form.avgReelViews}    onChange={v => set('avgReelViews', v)}    placeholder="e.g. 80,000" />
                      <FInput icon={BarChart2}  label="Avg Story Reach"      value={form.avgStoryReach}   onChange={v => set('avgStoryReach', v)}   placeholder="e.g. 15,000" />
                    </div>
                    <FTextarea label="Audience Location Notes" value={form.audienceNotes} onChange={v => set('audienceNotes', v)}
                      placeholder="e.g. Mainly UAE-based, 65% female" rows={3} />
                    <div style={{ marginTop: '1rem' }}>
                      <FToggle label="Insights screenshots received" value={form.insightsReceived} onChange={v => set('insightsReceived', v)} />
                    </div>
                  </>
                )}

                {activeSection.id === 'commercial' && (
                  <>
                    <div className="aif-grid-3">
                      <FSelect icon={DollarSign} label="Currency"        value={form.currency}          onChange={v => set('currency', v)}          options={CURRENCIES} />
                      <FInput  icon={DollarSign} label="Reels Price"     value={form.reelsPrice}        onChange={v => set('reelsPrice', v)}        placeholder="0" type="number" />
                      <FInput  icon={DollarSign} label="Stories Price"   value={form.storiesPrice}      onChange={v => set('storiesPrice', v)}      placeholder="0" type="number" />
                      <FInput  icon={DollarSign} label="Package Price"   value={form.packagePrice}      onChange={v => set('packagePrice', v)}      placeholder="0" type="number" />
                      <FSelect icon={Sparkles}   label="Collaboration"   value={form.collaborationType} onChange={v => set('collaborationType', v)} options={['', ...COLLABORATION_TYPES]} />
                    </div>
                    <FTextarea label="Deliverables" value={form.deliverables} onChange={v => set('deliverables', v)}
                      placeholder="e.g. 1 Reel + 3 Stories on influencer page" rows={3} />
                    <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <FToggle label="Reel stays on influencer's own page" value={form.reelStaysOnPage} onChange={v => set('reelStaysOnPage', v)} />
                      <FToggle label="Content production for brand usage included" value={form.contentForBrand} onChange={v => set('contentForBrand', v)} />
                    </div>
                  </>
                )}

                {activeSection.id === 'contact' && (
                  <>
                    <div className="aif-grid-2">
                      <FSelect icon={Phone}    label="Contact Status"      value={form.contactStatus}    onChange={v => set('contactStatus', v)}    options={CONTACT_STATUSES} />
                      <FInput  icon={Calendar} label="Follow-up Reminder"  value={form.followUpReminder} onChange={v => set('followUpReminder', v)} type="date" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                      <FTextarea label="Discussion Notes"       value={form.discussionNotes}  onChange={v => set('discussionNotes', v)}  placeholder="Notes from initial discussions" rows={3} />
                      <FTextarea label="Price Negotiation Notes" value={form.negotiationNotes} onChange={v => set('negotiationNotes', v)} placeholder="Pricing discussion details" rows={3} />
                      <FTextarea label="Approval Notes"         value={form.approvalNotes}    onChange={v => set('approvalNotes', v)}    placeholder="Why approved / key considerations" rows={2} />
                      <FTextarea label="Rejection Notes"        value={form.rejectionNotes}   onChange={v => set('rejectionNotes', v)}   placeholder="Reason for rejection (if applicable)" rows={2} />
                    </div>
                    <div style={{ marginTop: '1rem' }}>
                      <FToggle label="Offer / brief has been shared" value={form.offerShared} onChange={v => set('offerShared', v)} />
                    </div>
                  </>
                )}

                {activeSection.id === 'payment' && (
                  <>
                    <div className="aif-grid-2">
                      <FInput  icon={Building2}  label="Bank Name"            value={form.bankName}      onChange={v => set('bankName', v)}      placeholder="e.g. Emirates NBD" />
                      <FInput  icon={User}        label="Account Title"        value={form.accountTitle}  onChange={v => set('accountTitle', v)}  placeholder="Account holder name" />
                      <FInput  icon={CreditCard}  label="IBAN / Account No."  value={form.iban}          onChange={v => set('iban', v)}          placeholder="AE..." />
                      <FSelect icon={CreditCard}  label="Payment Method"       value={form.paymentMethod} onChange={v => set('paymentMethod', v)} options={['', 'Bank Transfer', 'Cash', 'Cheque', 'Online Transfer', 'Other']} />
                    </div>
                    <FTextarea label="Payment Notes" value={form.paymentNotes} onChange={v => set('paymentNotes', v)} placeholder="Any notes for finance team" rows={3} />
                  </>
                )}

                {activeSection.id === 'status' && (
                  <div className="aif-grid-2">
                    <FSelect icon={BadgeCheck} label="Workflow Stage"   value={form.workflowStatus}  onChange={v => set('workflowStatus', v)}  options={WORKFLOW_STAGES} />
                    <FSelect icon={BadgeCheck} label="Approval Status"  value={form.approvalStatus}  onChange={v => set('approvalStatus', v)}  options={APPROVAL_STATUSES} />
                    <FSelect icon={CreditCard} label="Payment Status"   value={form.paymentStatus}   onChange={v => set('paymentStatus', v)}   options={PAYMENT_STATUSES} />
                    <FInput  icon={User}       label="Assigned To"      value={form.assignedTo}      onChange={v => set('assignedTo', v)}      placeholder="Team member name" />
                    <FInput  icon={Calendar}   label="Shoot Date"       value={form.shootDate}       onChange={v => set('shootDate', v)}       type="date" />
                    <FInput  icon={Clock}      label="Shoot Time"       value={form.shootTime}       onChange={v => set('shootTime', v)}       type="time" />
                    <FInput  icon={MapPin}     label="Shoot Location"   value={form.shootLocation}   onChange={v => set('shootLocation', v)}   placeholder="Studio, store address…" />
                    <FInput  icon={FileText}   label="Campaign / Offer" value={form.campaign}        onChange={v => set('campaign', v)}        placeholder="Campaign name or offer details" />
                  </div>
                )}
              </div>

              {/* Live overview */}
              <div className="aif-body-grid__side">
                <div className="aif-overview">
                  <p className="aif-overview__heading">Live Overview</p>
                  <div className="aif-overview__metrics">
                    {OVERVIEW.map(m => (
                      <div key={m.title} className="aif-overview__metric">
                        <p className="aif-overview__metric-title">{m.title}</p>
                        <p className="aif-overview__metric-val">{m.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="aif-overview__note">
                    <p className="aif-overview__note-title">Profile Status</p>
                    <p className="aif-overview__note-body">
                      {form.name ? `Building profile for ${form.name}` : 'Enter influencer name to begin.'}{' '}
                      {form.instagram?.handle && `· ${form.instagram.handle}`}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="aif-footer">
            <div className="aif-footer__progress">
              <div className="aif-footer__progress-track">
                <div className="aif-footer__progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="aif-footer__pct">{pct}%</span>
            </div>
            <div className="aif-footer__btns">
              {stepIdx > 0 && (
                <button type="button" className="aif-btn aif-btn--ghost"
                  onClick={() => setStepIdx(i => Math.max(i - 1, 0))}>
                  Previous
                </button>
              )}
              {stepIdx < SECTIONS.length - 1 ? (
                <button type="button" className="aif-btn aif-btn--next"
                  onClick={() => setStepIdx(i => Math.min(i + 1, SECTIONS.length - 1))}>
                  Continue <ChevronRight size={15} />
                </button>
              ) : (
                <button type="button" className="aif-btn aif-btn--primary" onClick={handleSubmit}>
                  {saved ? '✓ Saved' : isEdit ? '💾 Save Changes' : '+ Create Profile'}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )

  if (asModal) {
    return (
      <div className="inf-modal-overlay" onClick={handleCancel}>
        <div className="aif-modal-shell" onClick={e => e.stopPropagation()}>
          {pageContent}
        </div>
      </div>
    )
  }

  return pageContent
}
