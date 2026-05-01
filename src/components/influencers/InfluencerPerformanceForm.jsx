import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, CalendarDays, FileImage, Link2, NotebookPen, Save, Sparkles, X } from 'lucide-react'
import { addDays, calculateEngagementRate, getDayNumber, INFLUENCER_PLATFORMS, normalizePerformanceRecord } from '../../utils/influencerPerformanceUtils'

const emptyForm = {
  influencerId: '',
  date: new Date().toISOString().slice(0, 10),
  platform: 'Instagram',
  postUrl: '',
  campaignName: '',
  videoTitle: '',
  contractStartDate: new Date().toISOString().slice(0, 10),
  monitoringDays: 5,
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
  const [influencerQuery, setInfluencerQuery] = useState('')

  useEffect(() => {
    if (editingRecord) {
      const editedInfluencer = influencers.find((item) => String(item.id) === String(editingRecord.influencerId))
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
      setInfluencerQuery(editedInfluencer?.name || '')
      setErrors({})
      return
    }
    const defaultInfluencer = influencers.find((item) => String(item.id) === String(form.influencerId)) || influencers[0]
    setForm((prev) => ({
      ...emptyForm,
      influencerId: prev.influencerId || influencers[0]?.id || '',
      platform: influencers.find((item) => String(item.id) === String(prev.influencerId))?.platform || influencers[0]?.platform || 'Instagram',
      campaignName: influencers.find((item) => String(item.id) === String(prev.influencerId))?.assignedCampaign || influencers[0]?.assignedCampaign || '',
      videoTitle: influencers.find((item) => String(item.id) === String(prev.influencerId))?.assignedCampaign || influencers[0]?.assignedCampaign || '',
      contractStartDate: prev.contractStartDate || emptyForm.contractStartDate,
    }))
    setInfluencerQuery((prev) => prev || defaultInfluencer?.name || '')
    setErrors({})
  }, [editingRecord, influencers])

  const selectedInfluencer = useMemo(
    () => influencers.find((item) => String(item.id) === String(form.influencerId)),
    [form.influencerId, influencers],
  )

  const influencerMatches = useMemo(() => {
    const q = influencerQuery.trim().toLowerCase()
    return influencers
      .filter((influencer) => {
        if (!q) return true
        return `${influencer.name} ${influencer.username} ${influencer.platform} ${influencer.assignedCampaign}`.toLowerCase().includes(q)
      })
      .slice(0, 8)
  }, [influencerQuery, influencers])

  const engagementRate = calculateEngagementRate(form)
  const checkInDay = getDayNumber(form.contractStartDate || form.date, form.date)

  function set(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }))
  }

  function validate() {
    const next = {}
    if (!form.influencerId) next.influencerId = 'Select an influencer'
    if (!form.date) next.date = 'Select a date'
    if (!form.platform) next.platform = 'Select a platform'
    if (!form.campaignName.trim()) next.campaignName = 'Contract / campaign is required'
    if (!form.contractStartDate) next.contractStartDate = 'Start date is required'
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
      videoTitle: influencer?.assignedCampaign || prev.videoTitle,
      contractStartDate: prev.contractStartDate || form.date,
    }))
    setInfluencerQuery(influencer?.name || '')
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
      contractStartDate: form.contractStartDate || form.date,
      monitoringDays: Number(form.monitoringDays) || 5,
      createdAt: editingRecord?.createdAt || now,
      updatedAt: now,
    }))
    const nextDate = addDays(form.date, 1)
    setForm({
      ...emptyForm,
      influencerId: form.influencerId,
      platform: form.platform,
      campaignName: form.campaignName,
      videoTitle: form.videoTitle,
      postUrl: form.postUrl,
      contractStartDate: form.contractStartDate || form.date,
      monitoringDays: form.monitoringDays || 5,
      date: nextDate,
    })
    setErrors({})
  }

  return (
    <section className="ip-form-panel" aria-label="Daily performance input form">
      <div className="ip-section-heading">
        <span className="ip-section-heading__icon"><NotebookPen size={18} /></span>
        <div>
          <h2>{editingRecord ? 'Edit video check-in' : 'Add video check-in'}</h2>
          <p>Use the same video contract and start date for Day 1 to Day 5 checks. Engagement is calculated automatically.</p>
        </div>
      </div>

      <form className="ip-form" onSubmit={handleSubmit}>
        <div className="ip-form-layout">
          <div className="ip-form-section-card ip-form-section-card--contract">
            <div className="ip-form-section-card__head">
              <span>1</span>
              <div>
                <h3>Video contract</h3>
                <p>Set this once, then enter Day 1 to Day 5 numbers.</p>
              </div>
            </div>

            <div className="ip-form-stack">
              <Field label="Influencer" error={errors.influencerId}>
                <input
                  className="ip-control"
                  value={influencerQuery}
                  onChange={(event) => {
                    setInfluencerQuery(event.target.value)
                    if (form.influencerId) set('influencerId', '')
                  }}
                  placeholder="Search influencer name, handle, platform"
                />
                <div className="ip-form-influencer-results">
                  {influencerMatches.map((influencer) => (
                    <button
                      key={influencer.id}
                      type="button"
                      className={`ip-form-influencer-result ${String(form.influencerId) === String(influencer.id) ? 'ip-form-influencer-result--active' : ''}`}
                      onClick={() => handleInfluencerChange(influencer.id)}
                    >
                      <span>
                        <strong>{influencer.name}</strong>
                        <em>{influencer.username} · {influencer.platform}</em>
                      </span>
                      <b>{influencer.followers?.toLocaleString?.() || influencer.followers || 0} followers</b>
                    </button>
                  ))}
                </div>
              </Field>

              <div className="ip-form-inline">
                <Field label="Platform" error={errors.platform}>
                  <select className="ip-control" value={form.platform} onChange={(event) => set('platform', event.target.value)}>
                    {INFLUENCER_PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>{platform}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Window">
                  <select className="ip-control" value={form.monitoringDays} onChange={(event) => set('monitoringDays', event.target.value)}>
                    <option value={4}>4 days</option>
                    <option value={5}>5 days</option>
                    <option value={6}>6 days</option>
                    <option value={7}>7 days</option>
                  </select>
                </Field>
              </div>

              <Field label="Contract / campaign" error={errors.campaignName}>
                <div className="ip-control-icon">
                  <Sparkles size={16} />
                  <input className="ip-control" value={form.campaignName} onChange={(event) => {
                    set('campaignName', event.target.value)
                    if (!form.videoTitle) set('videoTitle', event.target.value)
                  }} placeholder="Weekly video contract" />
                </div>
              </Field>

              <Field label="Video title">
                <input className="ip-control" value={form.videoTitle} onChange={(event) => set('videoTitle', event.target.value)} placeholder="e.g. Ramadan Glow reel" />
              </Field>

              <Field label="Video link">
                <div className="ip-control-icon">
                  <Link2 size={16} />
                  <input className="ip-control" type="url" value={form.postUrl} onChange={(event) => set('postUrl', event.target.value)} placeholder="https://..." />
                </div>
              </Field>
            </div>
          </div>

          <div className="ip-form-section-card">
            <div className="ip-form-section-card__head">
              <span>2</span>
              <div>
                <h3>Daily check-in</h3>
                <p>{selectedInfluencer ? `${selectedInfluencer.name} · Day ${checkInDay || 1}` : 'Enter today’s video numbers.'}</p>
              </div>
            </div>

            <div className="ip-form-inline ip-form-inline--dates">
              <Field label="Check date" error={errors.date}>
                <div className="ip-control-icon">
                  <CalendarDays size={16} />
                  <input className="ip-control" type="date" value={form.date} onChange={(event) => set('date', event.target.value)} />
                </div>
              </Field>

              <Field label="Start date" error={errors.contractStartDate}>
                <input className="ip-control" type="date" value={form.contractStartDate} onChange={(event) => set('contractStartDate', event.target.value)} />
              </Field>
            </div>

            <div className="ip-metric-grid">
              {['views', 'likes', 'comments', 'shares', 'saves', 'followersGained', 'storyViews'].map((key) => (
                <Field key={key} label={key.replace(/([A-Z])/g, ' $1')} error={errors[key]}>
                  <input className="ip-control ip-control--metric" type="number" min="0" value={form[key]} onChange={(event) => set(key, event.target.value)} placeholder="0" />
                </Field>
              ))}

              <Field label="Cost" error={errors.cost}>
                <div className="ip-control-icon">
                  <BadgeDollarSign size={16} />
                  <input className="ip-control ip-control--metric" type="number" min="0" step="0.01" value={form.cost} onChange={(event) => set('cost', event.target.value)} placeholder="0.00" />
                </div>
              </Field>
            </div>

            <div className="ip-form-bottom-grid">
              <Field label="Engagement rate">
                <input className="ip-control ip-control--readonly" readOnly value={`${engagementRate.toFixed(2)}%`} />
              </Field>

              <Field label="Screenshot">
                <div className="ip-file-control">
                  <FileImage size={16} />
                  <span>{form.screenshotUrl || 'Optional screenshot'}</span>
                  <input type="file" accept="image/*" onChange={(event) => handleScreenshotChange(event.target.files?.[0])} />
                </div>
              </Field>
            </div>

            <Field label="Notes">
              <textarea className="ip-control ip-control--textarea" value={form.notes} onChange={(event) => set('notes', event.target.value)} placeholder="What changed today? Story boost, repost, comments, campaign note..." />
            </Field>
          </div>
        </div>

        <div className="ip-form__footer">
          <div className="ip-form__hint">
            {selectedInfluencer ? `${selectedInfluencer.name} · Day ${checkInDay || 1} of ${form.monitoringDays || 5} for this video contract` : 'Ready for backend API integration'}
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
