import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, CalendarDays, FileImage, Link2, NotebookPen, Save, Sparkles, X } from 'lucide-react'
import { calculateEngagementRate, INFLUENCER_PLATFORMS, normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'

const emptyForm = {
  influencerId: '',
  date: new Date().toISOString().slice(0, 10),
  platform: 'Instagram',
  postUrl: '',
  campaignName: '',
  views: '',
  likes: '',
  comments: '',
  shares: '',
  saves: '',
  followersGained: '',
  storyViews: '',
  cost: '',
  notes: '',
  screenshotUrl: '',
}

function Field({ label, error, children, wide = false }) {
  return (
    <label className={`ip-field ${wide ? 'ip-field--wide' : ''}`}>
      <span>{label}</span>
      {children}
      {error ? <small>{error}</small> : null}
    </label>
  )
}

export function InfluencerPerformanceForm({ influencers, editingRecord, onSubmit, onCancelEdit }) {
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (editingRecord) {
      setForm({
        ...emptyForm,
        ...editingRecord,
        views: String(editingRecord.views ?? ''),
        likes: String(editingRecord.likes ?? ''),
        comments: String(editingRecord.comments ?? ''),
        shares: String(editingRecord.shares ?? ''),
        saves: String(editingRecord.saves ?? ''),
        followersGained: String(editingRecord.followersGained ?? ''),
        storyViews: String(editingRecord.storyViews ?? ''),
        cost: String(editingRecord.cost ?? ''),
      })
      setErrors({})
      return
    }
    setForm((prev) => ({ ...emptyForm, influencerId: prev.influencerId || influencers[0]?.id || '' }))
    setErrors({})
  }, [editingRecord, influencers])

  const selectedInfluencer = useMemo(
    () => influencers.find((item) => String(item.id) === String(form.influencerId)),
    [form.influencerId, influencers],
  )

  const engagementRate = calculateEngagementRate(form)

  function set(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }))
  }

  function validate() {
    const next = {}
    if (!form.influencerId) next.influencerId = 'Select an influencer'
    if (!form.date) next.date = 'Select a date'
    if (!form.platform) next.platform = 'Select a platform'
    if (!form.campaignName.trim()) next.campaignName = 'Campaign name is required'
    if (Number(form.views) < 0) next.views = 'Views cannot be negative'
    ;['likes', 'comments', 'shares', 'saves', 'followersGained', 'storyViews', 'cost'].forEach((key) => {
      if (Number(form[key]) < 0) next[key] = 'Value cannot be negative'
    })
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleInfluencerChange(value) {
    const influencer = influencers.find((item) => String(item.id) === String(value))
    setForm((prev) => ({
      ...prev,
      influencerId: value,
      platform: influencer?.platform || prev.platform,
      campaignName: influencer?.assignedCampaign || prev.campaignName,
    }))
    if (errors.influencerId) setErrors((prev) => ({ ...prev, influencerId: '' }))
  }

  function handleScreenshotChange(file) {
    if (!file) {
      set('screenshotUrl', '')
      return
    }
    set('screenshotUrl', file.name)
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (!validate()) return
    const now = new Date().toISOString()
    onSubmit(normalizePerformanceRecord({
      ...form,
      id: editingRecord?.id,
      screenshotUrl: form.screenshotUrl,
      createdAt: editingRecord?.createdAt || now,
      updatedAt: now,
    }))
    setForm({
      ...emptyForm,
      influencerId: influencers[0]?.id || '',
      platform: influencers[0]?.platform || 'Instagram',
      campaignName: influencers[0]?.assignedCampaign || '',
    })
    setErrors({})
  }

  return (
    <section className="ip-form-panel" aria-label="Daily performance input form">
      <div className="ip-section-heading">
        <span className="ip-section-heading__icon"><NotebookPen size={18} /></span>
        <div>
          <h2>{editingRecord ? 'Edit daily performance' : 'Add daily performance'}</h2>
          <p>Engagement rate is calculated from likes, comments, shares, saves, and views.</p>
        </div>
      </div>

      <form className="ip-form" onSubmit={handleSubmit}>
        <div className="ip-form-grid">
          <Field label="Influencer" error={errors.influencerId}>
            <select className="ip-control" value={form.influencerId} onChange={(event) => handleInfluencerChange(event.target.value)}>
              <option value="">Select influencer</option>
              {influencers.map((influencer) => (
                <option key={influencer.id} value={influencer.id}>{influencer.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Date" error={errors.date}>
            <div className="ip-control-icon">
              <CalendarDays size={16} />
              <input className="ip-control" type="date" value={form.date} onChange={(event) => set('date', event.target.value)} />
            </div>
          </Field>

          <Field label="Platform" error={errors.platform}>
            <select className="ip-control" value={form.platform} onChange={(event) => set('platform', event.target.value)}>
              {INFLUENCER_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>{platform}</option>
              ))}
            </select>
          </Field>

          <Field label="Campaign name" error={errors.campaignName}>
            <div className="ip-control-icon">
              <Sparkles size={16} />
              <input className="ip-control" value={form.campaignName} onChange={(event) => set('campaignName', event.target.value)} placeholder="Campaign name" />
            </div>
          </Field>

          <Field label="Post / Reel / Video link" wide>
            <div className="ip-control-icon">
              <Link2 size={16} />
              <input className="ip-control" type="url" value={form.postUrl} onChange={(event) => set('postUrl', event.target.value)} placeholder="https://..." />
            </div>
          </Field>

          {['views', 'likes', 'comments', 'shares', 'saves', 'followersGained', 'storyViews'].map((key) => (
            <Field key={key} label={key.replace(/([A-Z])/g, ' $1')} error={errors[key]}>
              <input className="ip-control" type="number" min="0" value={form[key]} onChange={(event) => set(key, event.target.value)} placeholder="0" />
            </Field>
          ))}

          <Field label="Cost / payment amount" error={errors.cost}>
            <div className="ip-control-icon">
              <BadgeDollarSign size={16} />
              <input className="ip-control" type="number" min="0" step="0.01" value={form.cost} onChange={(event) => set('cost', event.target.value)} placeholder="0.00" />
            </div>
          </Field>

          <Field label="Engagement rate">
            <input className="ip-control ip-control--readonly" readOnly value={`${engagementRate.toFixed(2)}%`} />
          </Field>

          <Field label="Screenshot upload optional">
            <div className="ip-file-control">
              <FileImage size={16} />
              <input type="file" accept="image/*" onChange={(event) => handleScreenshotChange(event.target.files?.[0])} />
              <span>{form.screenshotUrl || 'No screenshot selected'}</span>
            </div>
          </Field>

          <Field label="Notes" wide>
            <textarea className="ip-control ip-control--textarea" value={form.notes} onChange={(event) => set('notes', event.target.value)} placeholder="Add context, content notes, or campaign observations" />
          </Field>
        </div>

        <div className="ip-form__footer">
          <div className="ip-form__hint">
            {selectedInfluencer ? `${selectedInfluencer.name} · ${selectedInfluencer.assignedCampaign}` : 'Ready for backend API integration'}
          </div>
          <div className="ip-form__actions">
            {editingRecord ? (
              <button type="button" className="inf-btn inf-btn--ghost" onClick={onCancelEdit}>
                <X size={15} /> Cancel
              </button>
            ) : null}
            <button type="submit" className="inf-btn inf-btn--primary">
              <Save size={15} /> {editingRecord ? 'Save changes' : 'Add record'}
            </button>
          </div>
        </div>
      </form>
    </section>
  )
}
