import { useState, useEffect } from 'react'
import { fmtDMY } from '../../utils/dateFormat'
import { nextShopActionHint, shopWorkflowLabel } from './annualLeaveLabels'
import './ShopVisitWorkflow.css'

/**
 * Main shop visit card: status, dates, notes, calculator hint, and actions (row-level).
 * Admin and employee CTAs; parent opens modals for confirm, reschedule, apply, complete, employee form.
 */
export function ShopVisitCard({
  row,
  isAdmin,
  isEmployee,
  onConfirm,
  onReschedule,
  onApplyCalculatorOpen,
  onMarkCompleteOpen,
  onSaveAdminNote,
  onOpenEmployeeShop,
}) {
  if (row.status !== 'Approved') return null
  const sv = row.shop_visit_status || 'PendingSubmission'
  if (['Cancelled'].includes(sv)) {
    return (
      <div className="al-sv-card sv-admin">
        <p className="sv-admin__muted">Shop visit workflow was cancelled for this leave.</p>
      </div>
    )
  }

  const [adminNote, setAdminNote] = useState(row.shop_visit_admin_note || '')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteErr, setNoteErr] = useState('')

  useEffect(() => {
    setAdminNote(row.shop_visit_admin_note || '')
  }, [row.id, row.shop_visit_admin_note])

  const saveNote = async () => {
    setNoteErr('')
    setNoteSaving(true)
    try {
      await onSaveAdminNote(row.id, { shop_visit_admin_note: adminNote })
    } catch (e) {
      setNoteErr(e.message || 'Failed')
    } finally {
      setNoteSaving(false)
    }
  }

  const snap = row.calculator_snapshot
  const amount = row.calculated_leave_amount

  const employeeCanSubmit =
    isEmployee &&
    ['PendingSubmission', 'Submitted'].includes(sv) &&
    !['Completed', 'Cancelled'].includes(sv)

  const adminNextStep = isAdmin
    ? (
      sv === 'Submitted'
        ? {
            label: 'Confirm visit',
            hint: 'Next step: confirm the employee submitted visit details.',
            onClick: () => onConfirm(row),
            className: 'al-btn al-btn--success al-btn--sm',
          }
        : sv === 'Confirmed'
          ? {
              label: 'Apply salary calculator',
              hint: 'Next step: pull the latest leave salary amount into this request.',
              onClick: () => onApplyCalculatorOpen(row),
              className: 'al-btn al-btn--ghost al-btn--sm',
            }
          : sv === 'MoneyCalculated'
            ? {
                label: 'Mark shop visit completed',
                hint: 'Final step: mark this workflow completed after handover.',
                onClick: () => onMarkCompleteOpen(row),
                className: 'al-btn al-btn--primary al-btn--sm',
              }
            : null
    )
    : null

  return (
    <div className="al-sv-card sv-admin">
      <div className="al-sv-card__title-row">
        <h4 className="al-sv-card__title">Main shop visit</h4>
        <span className="al-sv-card__pill">{shopWorkflowLabel(row)}</span>
      </div>

      <p className="al-sv-card__next">{nextShopActionHint(row)}</p>

      {employeeCanSubmit && onOpenEmployeeShop && (
        <div className="al-sv-card__next-action">
          <span className="al-sv-card__group-label">Your next action</span>
          <button type="button" className="al-btn al-btn--primary al-btn--sm" onClick={() => onOpenEmployeeShop(row)}>
            {sv === 'Submitted' ? 'Edit submitted visit' : 'Submit main shop visit'}
          </button>
        </div>
      )}

      {adminNextStep && (
        <div className="al-sv-card__next-action">
          <span className="al-sv-card__group-label">Recommended next action</span>
          <p className="al-sv-card__next-hint">{adminNextStep.hint}</p>
          <button type="button" className={adminNextStep.className} onClick={adminNextStep.onClick}>
            {adminNextStep.label}
          </button>
        </div>
      )}

      <div className="sv-admin__grid">
        <div>
          <span className="sv-admin__label">Employee submitted visit</span>
          <strong>
            {row.shop_visit_date
              ? `${fmtDMY(row.shop_visit_date)}${row.shop_visit_time ? ` · ${row.shop_visit_time}` : ''}`
              : '—'}
            {row.shop_visit_submitted_at && (
              <span className="al-sv-card__sub"> · Logged {fmtDMY(row.shop_visit_submitted_at)}</span>
            )}
          </strong>
        </div>
        <div>
          <span className="sv-admin__label">HR confirmed visit</span>
          <strong>
            {row.shop_visit_confirmed_at
              ? `Scheduled ${row.shop_visit_date ? fmtDMY(row.shop_visit_date) : '—'}${
                  row.shop_visit_time ? ` · ${row.shop_visit_time}` : ''
                } · Confirmed ${fmtDMY(row.shop_visit_confirmed_at)}`
              : '—'}
          </strong>
        </div>
        {row.shop_visit_note && (
          <div className="sv-admin__full">
            <span className="sv-admin__label">Employee note</span>
            <span>{row.shop_visit_note}</span>
          </div>
        )}
        {(amount != null || snap) && (
          <div className="sv-admin__full sv-admin__calc">
            <span className="sv-admin__label">From calculator (snapshot on request)</span>
            {amount != null && (
              <div className="sv-admin__amount">
                AED {Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
            {snap?.annual_leave_salary_id != null && (
              <span className="sv-admin__muted">
                Record #{snap.annual_leave_salary_id} · {snap.calculation_date ? fmtDMY(snap.calculation_date) : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="sv-admin__note">
          <label>
            Internal admin note
            <textarea rows={2} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />
          </label>
          {noteErr && <p className="sv-form__err">{noteErr}</p>}
          <div className="al-sv-card__act-row al-sv-card__act-row--note">
            <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={saveNote} disabled={noteSaving}>
              {noteSaving ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="al-sv-card__admin-actions">
          <span className="al-sv-card__group-label">Other admin actions</span>
          <div className="sv-admin__actions">
            {sv === 'Submitted' && (
              <button type="button" className="al-btn al-btn--success al-btn--sm" onClick={() => onConfirm(row)}>
                Confirm visit
              </button>
            )}
            {['Submitted', 'Confirmed', 'MoneyCalculated'].includes(sv) && sv !== 'Completed' && (
              <button type="button" className="al-btn al-btn--extend al-btn--sm" onClick={() => onReschedule(row)}>
                Reschedule
              </button>
            )}
            {['Confirmed', 'MoneyCalculated'].includes(sv) && (
              <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={() => onApplyCalculatorOpen(row)}>
                Apply salary calculator
              </button>
            )}
            {['Confirmed', 'MoneyCalculated'].includes(sv) && (
              <button type="button" className="al-btn al-btn--primary al-btn--sm" onClick={() => onMarkCompleteOpen(row)}>
                Mark shop visit completed
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
