import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { BadgeDollarSign, CalendarDays, FileImage, Link2, NotebookPen, Save, Sparkles, X } from 'lucide-react'
import { useAuth, canViewInfluencerPerformanceNetProfit } from '../../contexts/AuthContext'
import type {
  InfluencerPerformance,
  InfluencerPerformanceInput,
  InfluencerPerformanceProfile,
} from '../../types/influencer'
import {
  addDays,
  calculateEngagementRate,
  clampMonitoringDays,
  contractEndDateFromStartAndDays,
  daysBetweenIso,
  formatIsoDateDdMmYyyy,
  getDayNumber,
  INFLUENCER_PLATFORMS,
  monitoringDaysFromContractDates,
  normalizePerformanceRecord,
  parseDdMmYyyyToIso,
} from '../../utils/influencerPerformanceUtils'

type PerformanceFormState = {
  influencerId: string
  date: string
  platform: string
  postUrl: string
  campaignName: string
  contractStartDate: string
  contractEndDate: string
  monitoringDays: number
  views: string
  likes: string
  comments: string
  shares: string
  salesAed: string
  cost: string
  netProfitAed: string
  notes: string
  screenshotUrl: string
}

type FormFieldKey = keyof PerformanceFormState
type FormErrors = Partial<Record<FormFieldKey, string>>

interface FieldProps {
  label: string
  error?: string
  children: ReactNode
  wide?: boolean
}

interface InfluencerPerformanceFormProps {
  influencers: InfluencerPerformanceProfile[]
  editingRecord: InfluencerPerformance | InfluencerPerformanceInput | null
  defaultInfluencerId?: string
  onSubmit: (record: InfluencerPerformanceInput) => void
  onCancelEdit: () => void
}

const emptyForm: PerformanceFormState = {
  influencerId: '',
  date: new Date().toISOString().slice(0, 10),
  platform: 'Instagram',
  postUrl: '',
  campaignName: '',
  contractStartDate: new Date().toISOString().slice(0, 10),
  contractEndDate: new Date().toISOString().slice(0, 10),
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

function Field({ label, error, children, wide = false }: FieldProps) {
  return (
    <label className={`ip-field ${wide ? 'ip-field--wide' : ''}`}>
      <span>{label}</span>
      {children}
      {error ? <small>{error}</small> : null}
    </label>
  )
}

export function InfluencerPerformanceForm({
  influencers,
  editingRecord,
  defaultInfluencerId = '',
  onSubmit,
  onCancelEdit,
}: InfluencerPerformanceFormProps) {
  const { user } = useAuth()
  const showNetProfit = canViewInfluencerPerformanceNetProfit(user)
  const [form, setForm] = useState<PerformanceFormState>(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [influencerQuery, setInfluencerQuery] = useState('')
  const [openingDateText, setOpeningDateText] = useState(() => formatIsoDateDdMmYyyy(emptyForm.contractStartDate))
  const [endingDateText, setEndingDateText] = useState(() => formatIsoDateDdMmYyyy(emptyForm.contractEndDate))

  useEffect(() => {
    if (editingRecord) {
      const editedInfluencer = influencers.find((item) => String(item.id) === String(editingRecord.influencerId))
      const start = editingRecord.contractStartDate || editingRecord.date || emptyForm.contractStartDate
      const days = clampMonitoringDays(editingRecord.monitoringDays)
      const end = editingRecord.contractEndDate || contractEndDateFromStartAndDays(start, days)
      setForm({
        ...emptyForm,
        ...editingRecord,
        contractStartDate: start,
        contractEndDate: end,
        monitoringDays: days,
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
    setForm((prev) => {
      const start = prev.contractStartDate || emptyForm.contractStartDate
      const days = clampMonitoringDays(prev.monitoringDays)
      const preselected = defaultInfluencerId && influencers.some((item) => String(item.id) === String(defaultInfluencerId))
        ? String(defaultInfluencerId)
        : prev.influencerId || ''
      const preselectedInfluencer = influencers.find((item) => String(item.id) === preselected)
      return {
        ...emptyForm,
        influencerId: preselected,
        platform: preselectedInfluencer?.platform || prev.platform || 'Instagram',
        campaignName: preselectedInfluencer?.assignedCampaign || prev.campaignName || '',
        contractStartDate: start,
        contractEndDate: prev.contractEndDate || contractEndDateFromStartAndDays(start, days),
        monitoringDays: days,
      }
    })
    setInfluencerQuery(() => {
      const preselected = defaultInfluencerId && influencers.some((item) => String(item.id) === String(defaultInfluencerId))
        ? String(defaultInfluencerId)
        : ''
      const preselectedInfluencer = influencers.find((item) => String(item.id) === preselected)
      return preselectedInfluencer?.name || ''
    })
    setErrors({})
  }, [editingRecord, influencers, defaultInfluencerId])

  useEffect(() => {
    setOpeningDateText(formatIsoDateDdMmYyyy(form.contractStartDate))
  }, [form.contractStartDate])

  useEffect(() => {
    setEndingDateText(formatIsoDateDdMmYyyy(form.contractEndDate))
  }, [form.contractEndDate])

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

  function set<K extends FormFieldKey>(name: K, value: PerformanceFormState[K]) {
    setForm((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }))
  }

  function syncWindowFromDates(startIso: string, endIso: string) {
    const days = monitoringDaysFromContractDates(startIso, endIso)
    if (days) set('monitoringDays', days)
  }

  function applyOpeningIso(iso: string) {
    if (!iso) return
    set('contractStartDate', iso)
    const endIso = parseDdMmYyyyToIso(endingDateText) || form.contractEndDate
    if (endIso) {
      syncWindowFromDates(iso, endIso)
    } else {
      const end = contractEndDateFromStartAndDays(iso, form.monitoringDays)
      set('contractEndDate', end)
    }
  }

  function applyEndingIso(iso: string) {
    if (!iso) return
    set('contractEndDate', iso)
    const startIso = parseDdMmYyyyToIso(openingDateText) || form.contractStartDate
    if (startIso) syncWindowFromDates(startIso, iso)
  }

  function validate() {
    const next: FormErrors = {}
    const openingIso = parseDdMmYyyyToIso(openingDateText) || form.contractStartDate
    const endingIso = parseDdMmYyyyToIso(endingDateText) || form.contractEndDate
    if (!form.influencerId) next.influencerId = 'Select an influencer'
    if (!form.date) next.date = 'Missing check date'
    if (!form.platform) next.platform = 'Select a platform'
    if (!form.campaignName.trim()) next.campaignName = 'Contract / campaign is required'
    if (!openingIso) next.contractStartDate = 'Enter contract opening date as dd/mm/yyyy (e.g. 04/05/2026)'
    if (!endingIso) next.contractEndDate = 'Enter contract ending date as dd/mm/yyyy'
    if (openingIso && endingIso && daysBetweenIso(openingIso, endingIso) < 0) {
      next.contractEndDate = 'Ending date must be on or after opening date'
    }
    if (openingIso && endingIso) {
      const windowDays = monitoringDaysFromContractDates(openingIso, endingIso)
      if (!windowDays) next.contractEndDate = 'Contract window must be 3 to 5 days'
    }
    ;(['salesAed', 'cost'] as const).forEach((key) => {
      if (Number(form[key]) < 0) next[key] = 'Value cannot be negative'
    })
    if (showNetProfit && form.netProfitAed !== '' && !Number.isFinite(Number(form.netProfitAed))) {
      next.netProfitAed = 'Enter a valid number'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleInfluencerChange(value: string) {
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

  function handleScreenshotChange(file: File | undefined) {
    if (!file) {
      set('screenshotUrl', '')
      return
    }
    set('screenshotUrl', file.name)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validate()) return
    const dateIso = form.date
    const startIso = parseDdMmYyyyToIso(openingDateText) || form.contractStartDate || dateIso
    const endIso = parseDdMmYyyyToIso(endingDateText) || form.contractEndDate || contractEndDateFromStartAndDays(startIso, form.monitoringDays)
    const windowDays = monitoringDaysFromContractDates(startIso, endIso) || clampMonitoringDays(form.monitoringDays)
    const now = new Date().toISOString()
    const merged: PerformanceFormState & {
      date: string
      contractStartDate: string
      contractEndDate: string
      monitoringDays: number
      netProfitAed?: string | number
    } = { ...form, date: dateIso, contractStartDate: startIso, contractEndDate: endIso, monitoringDays: windowDays }
    if (!showNetProfit && editingRecord && Object.prototype.hasOwnProperty.call(editingRecord, 'netProfitAed')) {
      merged.netProfitAed = editingRecord.netProfitAed != null ? String(editingRecord.netProfitAed) : ''
    }
    const payload = {
      ...merged,
      id: editingRecord?.id,
      screenshotUrl: form.screenshotUrl,
      contractStartDate: startIso || dateIso,
      contractEndDate: endIso,
      monitoringDays: windowDays,
      createdAt: editingRecord?.createdAt || now,
      updatedAt: now,
      saves: editingRecord != null ? editingRecord.saves : 0,
      storyViews: editingRecord != null ? editingRecord.storyViews : 0,
    }
    onSubmit(normalizePerformanceRecord(payload))
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
        contractEndDate: endIso,
        monitoringDays: windowDays,
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
                <p>Influencer, platform, contract dates, campaign, and video link.</p>
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

              <Field label="Platform" error={errors.platform}>
                <select className="ip-control" value={form.platform} onChange={(event) => set('platform', event.target.value)}>
                  {INFLUENCER_PLATFORMS.map((platform) => (
                    <option key={platform} value={platform}>{platform}</option>
                  ))}
                </select>
              </Field>

              <div className="ip-form-inline ip-form-inline--dates">
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
                        if (iso) applyOpeningIso(iso)
                      }}
                      onBlur={() => {
                        const iso = parseDdMmYyyyToIso(openingDateText)
                        if (iso) {
                          applyOpeningIso(iso)
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

                <Field label="Contract ending date" error={errors.contractEndDate}>
                  <div className="ip-control-icon">
                    <CalendarDays size={16} />
                    <input
                      className="ip-control"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="dd/mm/yyyy"
                      maxLength={10}
                      value={endingDateText}
                      onChange={(event) => {
                        const v = event.target.value
                        setEndingDateText(v)
                        const iso = parseDdMmYyyyToIso(v.trim())
                        if (iso) applyEndingIso(iso)
                      }}
                      onBlur={() => {
                        const iso = parseDdMmYyyyToIso(endingDateText)
                        if (iso) {
                          applyEndingIso(iso)
                          setEndingDateText(formatIsoDateDdMmYyyy(iso))
                          if (errors.contractEndDate) setErrors((prev) => ({ ...prev, contractEndDate: '' }))
                        } else if (endingDateText.trim()) {
                          setErrors((prev) => ({ ...prev, contractEndDate: 'Use dd/mm/yyyy' }))
                          setEndingDateText(formatIsoDateDdMmYyyy(form.contractEndDate))
                        }
                      }}
                      aria-invalid={Boolean(errors.contractEndDate)}
                    />
                  </div>
                </Field>
              </div>

              <Field label="Window (days)">
                <input
                  className="ip-control ip-control--readonly"
                  readOnly
                  value={`${clampMonitoringDays(form.monitoringDays)} days (auto)`}
                  aria-label={`Contract window ${clampMonitoringDays(form.monitoringDays)} days`}
                />
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
