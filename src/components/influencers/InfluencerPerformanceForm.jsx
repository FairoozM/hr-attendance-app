import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, CalendarDays, FileImage, Link2, NotebookPen, Save, Sparkles, X } from 'lucide-react'
import { useAuth, canViewInfluencerPerformanceNetProfit } from '../../contexts/AuthContext'
import {
  addDays,
  calculateEngagementRate,
  formatIsoDateDdMmYyyy,
  getDayNumber,
  INFLUENCER_PLATFORMS,
  normalizePerformanceRecord,
  parseDdMmYyyyToIso,
} from '../../utils/influencerPerformanceUtils'

const emptyForm = {
  influencerId: '',
  date: new Date().toISOString().slice(0, 10),
  platform: 'Instagram',
  postUrl: '',
  campaignName: '',
  contractStartDate: new Date().toISOString().slice(0, 10),
  monitoringDays: 5,
  views: '',
  likes: '',
  comments: '',
  shares: '',
  salesAed: '',
  cost: '',
  netProfitAed: '',
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
  const { user } = useAuth()
  const showNetProfit = canViewInfluencerPerformanceNetProfit(user)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [influencerQuery, setInfluencerQuery] = useState('')
  const [openingDateText, setOpeningDateText] = useState(() => formatIsoDateDdMmYyyy(emptyForm.contractStartDate))

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
        salesAed: String(editingRecord.salesAed ?? ''),
        cost: String(editingRecord.cost ?? ''),
        netProfitAed: String(editingRecord.netProfitAed ?? ''),
      })
      setInfluencerQuery(editedInfluencer?.name || '')
      setErrors({})
      return
    }
    setForm((prev) => ({
      ...emptyForm,
      influencerId: prev.influencerId || '',
      platform: prev.platform || 'Instagram',
      campaignName: prev.campaignName || '',
      contractStartDate: prev.contractStartDate || emptyForm.contractStartDate,
    }))
    setInfluencerQuery('')
    setErrors({})
  }, [editingRecord, influencers])

  useEffect(() => {
    setOpeningDateText(formatIsoDateDdMmYyyy(form.contractStartDate))
  }, [form.contractStartDate])

  const selectedInfluencer = useMemo(
    () => influencers.find((item) => String(item.id) === String(form.influencerId)),
    [form.influencerId, influencers],
  )

  const influencerMatches = useMemo(() => {
    const q = influencerQuery.trim().toLowerCase()
    if (!q) return []
    return influencers
      .filter((influencer) => {
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
    const openingIso = parseDdMmYyyyToIso(openingDateText) || form.contractStartDate
    if (!form.influencerId) next.influencerId = 'Select an influencer'
    if (!form.date) next.date = 'Missing check date'
    if (!form.platform) next.platform = 'Select a platform'
    if (!form.campaignName.trim()) next.campaignName = 'Contract / campaign is required'
    if (!openingIso) next.contractStartDate = 'Enter contract opening date as dd/mm/yyyy (e.g. 04/05/2026)'
    ;['salesAed', 'cost'].forEach((key) => {
      if (Number(form[key]) < 0) next[key] = 'Value cannot be negative'
    })
    if (showNetProfit && form.netProfitAed !== '' && !Number.isFinite(Number(form.netProfitAed))) {
      next.netProfitAed = 'Enter a valid number'
    }
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
    const dateIso = form.date
    const startIso = parseDdMmYyyyToIso(openingDateText) || form.contractStartDate || dateIso
    const now = new Date().toISOString()
    const merged = { ...form, date: dateIso, contractStartDate: startIso }
    if (!showNetProfit && editingRecord && Object.prototype.hasOwnProperty.call(editingRecord, 'netProfitAed')) {
      merged.netProfitAed = editingRecord.netProfitAed
    }
    onSubmit(normalizePerformanceRecord({
      ...merged,
      id: editingRecord?.id,
      screenshotUrl: form.screenshotUrl,
      contractStartDate: startIso || dateIso,
      monitoringDays: Number(form.monitoringDays) || 5,
      createdAt: editingRecord?.createdAt || now,
      updatedAt: now,
      saves: editingRecord != null ? editingRecord.saves : 0,
      storyViews: editingRecord != null ? editingRecord.storyViews : 0,
    }))
    if (!editingRecord) {
      const nextDate = addDays(dateIso, 1)
      const contractStart = startIso || dateIso
      setForm({
        ...emptyForm,
        influencerId: form.influencerId,
        platform: form.platform,
        campaignName: form.campaignName,
        postUrl: form.postUrl,
        contractStartDate: contractStart,
        monitoringDays: form.monitoringDays || 5,
        date: nextDate,
      })
    }
    setErrors({})
  }

  return (
    <section className="ip-form-panel" aria-label="Performance record form">
      <div className="ip-section-heading">
        <span className="ip-section-heading__icon"><NotebookPen size={18} /></span>
        <div>
          <h2>{editingRecord ? 'Edit record' : 'Add record'}</h2>
          <p>
            Influencer, contract, and financial fields. Daily views, story posting, likes, comments, and shares are edited in the contract timeline.
          </p>
        </div>
      </div>

      <form className="ip-form" onSubmit={handleSubmit}>
        <div className="ip-form-layout">
          <div className="ip-form-section-card ip-form-section-card--contract">
            <div className="ip-form-section-card__head">
              <span>1</span>
              <div>
                <h3>Video contract</h3>
                <p>Influencer, platform, window, contract opening date, campaign, and video link.</p>
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
                        <em>{influencer.username}</em>
                      </span>
                      <b>{influencer.followers?.toLocaleString?.() || influencer.followers || 0} followers</b>
                    </button>
                  ))}
                  {influencerQuery.trim() && influencerMatches.length === 0 ? (
                    <div className="ip-form-influencer-empty">No influencer found.</div>
                  ) : null}
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

              <Field label="Contract opening date" error={errors.contractStartDate}>
                <div className="ip-control-icon">
                  <CalendarDays size={16} />
                  <input
                    className="ip-control"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="dd/mm/yyyy"
                    maxLength={10}
                    value={openingDateText}
                    onChange={(event) => {
                      const v = event.target.value
                      setOpeningDateText(v)
                      const iso = parseDdMmYyyyToIso(v.trim())
                      if (iso) set('contractStartDate', iso)
                    }}
                    onBlur={() => {
                      const iso = parseDdMmYyyyToIso(openingDateText)
                      if (iso) {
                        set('contractStartDate', iso)
                        setOpeningDateText(formatIsoDateDdMmYyyy(iso))
                        if (errors.contractStartDate) setErrors((prev) => ({ ...prev, contractStartDate: '' }))
                      } else if (openingDateText.trim()) {
                        setErrors((prev) => ({ ...prev, contractStartDate: 'Use dd/mm/yyyy' }))
                        setOpeningDateText(formatIsoDateDdMmYyyy(form.contractStartDate))
                      }
                    }}
                    aria-invalid={Boolean(errors.contractStartDate)}
                  />
                </div>
              </Field>

              <Field label="Contract / campaign" error={errors.campaignName}>
                <div className="ip-control-icon">
                  <Sparkles size={16} />
                  <input className="ip-control" value={form.campaignName} onChange={(event) => set('campaignName', event.target.value)} placeholder="Weekly video contract" />
                </div>
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
                <h3>Financials &amp; engagement</h3>
                <p>Sales AED, cost, net profit, engagement (from timeline metrics), screenshot, and notes.</p>
              </div>
            </div>

            <div className="ip-metric-grid">
              <Field label="Sales AED" error={errors.salesAed}>
                <input
                  className="ip-control ip-control--metric"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.salesAed}
                  onChange={(event) => set('salesAed', event.target.value)}
                  placeholder="0.00"
                />
              </Field>

              <Field label="Cost" error={errors.cost}>
                <div className="ip-control-icon">
                  <BadgeDollarSign size={16} />
                  <input className="ip-control ip-control--metric" type="number" min="0" step="0.01" value={form.cost} onChange={(event) => set('cost', event.target.value)} placeholder="0.00" />
                </div>
              </Field>

              {showNetProfit ? (
                <Field label="Net profit AED" error={errors.netProfitAed}>
                  <div className="ip-control-icon">
                    <BadgeDollarSign size={16} />
                    <input
                      className="ip-control ip-control--metric"
                      type="number"
                      step="0.01"
                      value={form.netProfitAed}
                      onChange={(event) => set('netProfitAed', event.target.value)}
                      placeholder="After costs / fees"
                    />
                  </div>
                </Field>
              ) : null}
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
              <textarea className="ip-control ip-control--textarea" value={form.notes} onChange={(event) => set('notes', event.target.value)} placeholder="Campaign notes, fees, context…" />
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
