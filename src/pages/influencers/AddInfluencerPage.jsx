import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
  { id: 'basic', label: 'Basic Details', icon: '👤' },
  { id: 'social', label: 'Social Media', icon: '📱' },
  { id: 'audience', label: 'Audience & Profile', icon: '📊' },
  { id: 'commercial', label: 'Commercial', icon: '💰' },
  { id: 'contact', label: 'Contact & Negotiation', icon: '💬' },
  { id: 'payment', label: 'Payment Details', icon: '🏦' },
  { id: 'status', label: 'Status & Assignment', icon: '📋' },
]

function Toggle({ value, onChange, label }) {
  return (
    <div className="inf-toggle-wrap">
      <button
        type="button"
        className={`inf-toggle ${value ? 'inf-toggle--on' : ''}`}
        onClick={() => onChange(!value)}
        aria-pressed={value}
      />
      <span className="inf-toggle-label">{label}</span>
    </div>
  )
}

function Field({ label, children, full }) {
  return (
    <div className={`inf-field ${full ? 'inf-field--full' : ''}`}>
      <label className="inf-label">{label}</label>
      {children}
    </div>
  )
}

function Input({ name, value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      className="inf-input"
      type={type}
      name={name}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  )
}

function FormSelect({ value, onChange, options }) {
  return (
    <select className="inf-form-select" value={value || ''} onChange={e => onChange(e.target.value)}>
      {options.map(o => typeof o === 'string'
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>
      )}
    </select>
  )
}

function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      className="inf-textarea"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
    />
  )
}

export function AddInfluencerPage() {
  const { influencers, addInfluencer, updateInfluencer } = useInfluencers()
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = Boolean(id)
  const existing = isEdit ? influencers.find(i => i.id === id) : null

  const [form, setForm] = useState(() => existing ? {
    ...EMPTY_FORM, ...existing,
    instagram: existing.instagram || { handle: '', url: '' },
    youtube: existing.youtube || { handle: '', url: '' },
    tiktok: existing.tiktok || { handle: '', url: '' },
  } : EMPTY_FORM)

  const [activeSection, setActiveSection] = useState('basic')
  const [saved, setSaved] = useState(false)

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const setNested = (key, subKey, val) => setForm(f => ({ ...f, [key]: { ...f[key], [subKey]: val } }))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (isEdit) {
      updateInfluencer(id, form)
    } else {
      const newId = addInfluencer(form)
      navigate(`/influencers/${newId}`)
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="inf-page">
      <div className="inf-page-header">
        <div>
          <h1 className="inf-page-title">{isEdit ? 'Edit Influencer' : 'Add Influencer'}</h1>
          <p className="inf-page-subtitle">{isEdit ? `Editing: ${existing?.name}` : 'Fill in the details to add a new influencer'}</p>
        </div>
        <div className="inf-page-actions">
          <button type="button" className="inf-btn inf-btn--ghost" onClick={() => navigate(-1)}>Cancel</button>
          <button type="button" className="inf-btn inf-btn--primary" onClick={handleSubmit}>
            {saved ? '✓ Saved' : isEdit ? 'Save Changes' : 'Add Influencer'}
          </button>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="inf-tabs">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            type="button"
            className={`inf-tab ${activeSection === s.id ? 'inf-tab--active' : ''}`}
            onClick={() => setActiveSection(s.id)}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Basic Details */}
        {activeSection === 'basic' && (
          <div className="inf-form-section">
            <div className="inf-form-section__header">
              <span className="inf-form-section__icon">👤</span>
              <h3 className="inf-form-section__title">Basic Details</h3>
            </div>
            <div className="inf-form-section__body">
              <div className="inf-grid-2">
                <Field label="Influencer Name *">
                  <Input value={form.name} onChange={v => set('name', v)} placeholder="Full name" required />
                </Field>
                <Field label="Niche / Category">
                  <Input value={form.niche} onChange={v => set('niche', v)} placeholder="e.g. Lifestyle, Beauty, Food" />
                </Field>
                <Field label="Mobile Number">
                  <Input value={form.mobile} onChange={v => set('mobile', v)} placeholder="+971 50 xxx xxxx" />
                </Field>
                <Field label="WhatsApp Number">
                  <Input value={form.whatsapp} onChange={v => set('whatsapp', v)} placeholder="+971 50 xxx xxxx" />
                </Field>
                <Field label="Email">
                  <Input value={form.email} onChange={v => set('email', v)} placeholder="email@example.com" type="email" />
                </Field>
                <Field label="Nationality">
                  <Input value={form.nationality} onChange={v => set('nationality', v)} placeholder="e.g. Emirati, Lebanese" />
                </Field>
                <Field label="Based In">
                  <Input value={form.basedIn} onChange={v => set('basedIn', v)} placeholder="e.g. Dubai, Abu Dhabi" />
                </Field>
              </div>
              <div style={{ marginTop: '1.1rem' }}>
                <Field label="Notes" full>
                  <Textarea value={form.notes} onChange={v => set('notes', v)} placeholder="Any general notes about this influencer" />
                </Field>
              </div>
            </div>
          </div>
        )}

        {/* Social Media */}
        {activeSection === 'social' && (
          <div className="inf-form-section">
            <div className="inf-form-section__header">
              <span className="inf-form-section__icon">📱</span>
              <h3 className="inf-form-section__title">Social Media Handles</h3>
            </div>
            <div className="inf-form-section__body">
              <div className="inf-grid-2">
                <Field label="Instagram Handle">
                  <Input value={form.instagram?.handle} onChange={v => setNested('instagram','handle',v)} placeholder="@handle" />
                </Field>
                <Field label="Instagram Profile URL">
                  <Input value={form.instagram?.url} onChange={v => setNested('instagram','url',v)} placeholder="https://instagram.com/..." />
                </Field>
                <Field label="YouTube Handle">
                  <Input value={form.youtube?.handle} onChange={v => setNested('youtube','handle',v)} placeholder="Channel name" />
                </Field>
                <Field label="YouTube Channel URL">
                  <Input value={form.youtube?.url} onChange={v => setNested('youtube','url',v)} placeholder="https://youtube.com/@..." />
                </Field>
                <Field label="TikTok Handle">
                  <Input value={form.tiktok?.handle} onChange={v => setNested('tiktok','handle',v)} placeholder="@handle" />
                </Field>
                <Field label="TikTok URL">
                  <Input value={form.tiktok?.url} onChange={v => setNested('tiktok','url',v)} placeholder="https://tiktok.com/@..." />
                </Field>
                <Field label="Snapchat Handle">
                  <Input value={form.snapchat} onChange={v => set('snapchat', v)} placeholder="username" />
                </Field>
                <Field label="Facebook Handle / Page">
                  <Input value={form.facebook} onChange={v => set('facebook', v)} placeholder="Page name or URL" />
                </Field>
                <Field label="X / Twitter Handle">
                  <Input value={form.twitter} onChange={v => set('twitter', v)} placeholder="@handle" />
                </Field>
                <Field label="Telegram Username / Channel">
                  <Input value={form.telegram} onChange={v => set('telegram', v)} placeholder="@username or channel" />
                </Field>
                <Field label="Website">
                  <Input value={form.website} onChange={v => set('website', v)} placeholder="https://..." />
                </Field>
                <Field label="Other Social Media">
                  <Input value={form.otherSocial} onChange={v => set('otherSocial', v)} placeholder="LinkedIn, Pinterest, etc." />
                </Field>
              </div>
            </div>
          </div>
        )}

        {/* Audience */}
        {activeSection === 'audience' && (
          <div className="inf-form-section">
            <div className="inf-form-section__header">
              <span className="inf-form-section__icon">📊</span>
              <h3 className="inf-form-section__title">Audience & Profile Details</h3>
            </div>
            <div className="inf-form-section__body">
              <div className="inf-grid-2">
                <Field label="Followers Count">
                  <Input value={form.followersCount} onChange={v => set('followersCount', v)} placeholder="e.g. 125,000" />
                </Field>
                <Field label="Engagement Rate">
                  <Input value={form.engagementRate} onChange={v => set('engagementRate', v)} placeholder="e.g. 4.2%" />
                </Field>
                <Field label="Average Reel Views">
                  <Input value={form.avgReelViews} onChange={v => set('avgReelViews', v)} placeholder="e.g. 80,000" />
                </Field>
                <Field label="Average Story Reach">
                  <Input value={form.avgStoryReach} onChange={v => set('avgStoryReach', v)} placeholder="e.g. 15,000" />
                </Field>
              </div>
              <div style={{ marginTop: '1.1rem' }}>
                <Field label="Audience Location Notes" full>
                  <Textarea value={form.audienceNotes} onChange={v => set('audienceNotes', v)} placeholder="e.g. Mainly UAE-based, 65% female" rows={2} />
                </Field>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <Toggle value={form.insightsReceived} onChange={v => set('insightsReceived', v)} label="Insights screenshots received" />
              </div>
            </div>
          </div>
        )}

        {/* Commercial */}
        {activeSection === 'commercial' && (
          <div className="inf-form-section">
            <div className="inf-form-section__header">
              <span className="inf-form-section__icon">💰</span>
              <h3 className="inf-form-section__title">Commercial Details</h3>
            </div>
            <div className="inf-form-section__body">
              <div className="inf-grid-3">
                <Field label="Currency">
                  <FormSelect value={form.currency} onChange={v => set('currency', v)} options={CURRENCIES} />
                </Field>
                <Field label="Reels Price">
                  <Input value={form.reelsPrice} onChange={v => set('reelsPrice', v)} placeholder="0" type="number" />
                </Field>
                <Field label="Stories Price">
                  <Input value={form.storiesPrice} onChange={v => set('storiesPrice', v)} placeholder="0" type="number" />
                </Field>
                <Field label="Package Price">
                  <Input value={form.packagePrice} onChange={v => set('packagePrice', v)} placeholder="0" type="number" />
                </Field>
                <Field label="Collaboration Type" full>
                  <FormSelect value={form.collaborationType} onChange={v => set('collaborationType', v)}
                    options={['', ...COLLABORATION_TYPES]} />
                </Field>
              </div>
              <div style={{ marginTop: '1.1rem' }}>
                <Field label="Deliverables" full>
                  <Textarea value={form.deliverables} onChange={v => set('deliverables', v)} placeholder="e.g. 1 Reel + 3 Stories on influencer page" rows={2} />
                </Field>
              </div>
              <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <Toggle value={form.reelStaysOnPage} onChange={v => set('reelStaysOnPage', v)} label="Reel stays on influencer's own page" />
                <Toggle value={form.contentForBrand} onChange={v => set('contentForBrand', v)} label="Content production for brand usage included" />
              </div>
            </div>
          </div>
        )}

        {/* Contact & Negotiation */}
        {activeSection === 'contact' && (
          <div className="inf-form-section">
            <div className="inf-form-section__header">
              <span className="inf-form-section__icon">💬</span>
              <h3 className="inf-form-section__title">Contact & Negotiation Details</h3>
            </div>
            <div className="inf-form-section__body">
              <div className="inf-grid-2">
                <Field label="Contact Status">
                  <FormSelect value={form.contactStatus} onChange={v => set('contactStatus', v)} options={CONTACT_STATUSES} />
                </Field>
                <Field label="Follow-up Reminder Date">
                  <Input value={form.followUpReminder} onChange={v => set('followUpReminder', v)} type="date" />
                </Field>
              </div>
              <div style={{ marginTop: '1.1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Field label="Discussion Notes" full>
                  <Textarea value={form.discussionNotes} onChange={v => set('discussionNotes', v)} placeholder="Notes from initial discussions" />
                </Field>
                <Field label="Price Negotiation Notes" full>
                  <Textarea value={form.negotiationNotes} onChange={v => set('negotiationNotes', v)} placeholder="Pricing discussion details" />
                </Field>
                <Field label="Approval Notes" full>
                  <Textarea value={form.approvalNotes} onChange={v => set('approvalNotes', v)} placeholder="Why approved / key considerations" />
                </Field>
                <Field label="Rejection Notes" full>
                  <Textarea value={form.rejectionNotes} onChange={v => set('rejectionNotes', v)} placeholder="Reason for rejection (if applicable)" />
                </Field>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                <Toggle value={form.offerShared} onChange={v => set('offerShared', v)} label="Offer / brief has been shared" />
              </div>
            </div>
          </div>
        )}

        {/* Payment Details */}
        {activeSection === 'payment' && (
          <div className="inf-form-section">
            <div className="inf-form-section__header">
              <span className="inf-form-section__icon">🏦</span>
              <h3 className="inf-form-section__title">Bank & Payment Details</h3>
            </div>
            <div className="inf-form-section__body">
              <div className="inf-grid-2">
                <Field label="Bank Name">
                  <Input value={form.bankName} onChange={v => set('bankName', v)} placeholder="e.g. Emirates NBD" />
                </Field>
                <Field label="Account Title">
                  <Input value={form.accountTitle} onChange={v => set('accountTitle', v)} placeholder="Account holder name" />
                </Field>
                <Field label="IBAN / Account Number">
                  <Input value={form.iban} onChange={v => set('iban', v)} placeholder="AE..." />
                </Field>
                <Field label="Payment Method">
                  <FormSelect value={form.paymentMethod} onChange={v => set('paymentMethod', v)}
                    options={['', 'Bank Transfer', 'Cash', 'Cheque', 'Online Transfer', 'Other']} />
                </Field>
              </div>
              <div style={{ marginTop: '1.1rem' }}>
                <Field label="Payment Notes" full>
                  <Textarea value={form.paymentNotes} onChange={v => set('paymentNotes', v)} placeholder="Any notes for finance team" rows={2} />
                </Field>
              </div>
            </div>
          </div>
        )}

        {/* Status & Assignment */}
        {activeSection === 'status' && (
          <div className="inf-form-section">
            <div className="inf-form-section__header">
              <span className="inf-form-section__icon">📋</span>
              <h3 className="inf-form-section__title">Status & Assignment</h3>
            </div>
            <div className="inf-form-section__body">
              <div className="inf-grid-2">
                <Field label="Workflow Stage">
                  <FormSelect value={form.workflowStatus} onChange={v => set('workflowStatus', v)} options={WORKFLOW_STAGES} />
                </Field>
                <Field label="Approval Status">
                  <FormSelect value={form.approvalStatus} onChange={v => set('approvalStatus', v)} options={APPROVAL_STATUSES} />
                </Field>
                <Field label="Payment Status">
                  <FormSelect value={form.paymentStatus} onChange={v => set('paymentStatus', v)} options={PAYMENT_STATUSES} />
                </Field>
                <Field label="Assigned To">
                  <Input value={form.assignedTo} onChange={v => set('assignedTo', v)} placeholder="Team member name" />
                </Field>
                <Field label="Shoot Date">
                  <Input value={form.shootDate} onChange={v => set('shootDate', v)} type="date" />
                </Field>
                <Field label="Shoot Time">
                  <Input value={form.shootTime} onChange={v => set('shootTime', v)} type="time" />
                </Field>
                <Field label="Shoot Location" full>
                  <Input value={form.shootLocation} onChange={v => set('shootLocation', v)} placeholder="Studio, store address, etc." />
                </Field>
                <Field label="Campaign / Offer" full>
                  <Input value={form.campaign} onChange={v => set('campaign', v)} placeholder="Campaign name or offer details" />
                </Field>
              </div>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {/* Section navigation */}
          {SECTIONS.findIndex(s => s.id === activeSection) > 0 && (
            <button type="button" className="inf-btn inf-btn--ghost" onClick={() => {
              const idx = SECTIONS.findIndex(s => s.id === activeSection)
              setActiveSection(SECTIONS[idx - 1].id)
            }}>
              ← Previous
            </button>
          )}
          {SECTIONS.findIndex(s => s.id === activeSection) < SECTIONS.length - 1 && (
            <button type="button" className="inf-btn inf-btn--ghost" onClick={() => {
              const idx = SECTIONS.findIndex(s => s.id === activeSection)
              setActiveSection(SECTIONS[idx + 1].id)
            }}>
              Next →
            </button>
          )}
          <button type="button" className="inf-btn inf-btn--ghost" onClick={() => navigate(-1)}>Cancel</button>
          <button type="submit" className="inf-btn inf-btn--primary inf-btn--lg">
            {saved ? '✓ Saved' : isEdit ? '💾 Save Changes' : '+ Add Influencer'}
          </button>
        </div>
      </form>
    </div>
  )
}
