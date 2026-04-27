import { fmtDMY } from '../../utils/dateFormat'
import {
  LEAVE_REQUEST_STEPS,
  leaveRequestStepperIndex,
  SHOP_WORKFLOW_STEPS,
  shopVisitStepperIndex,
  leaveStatusDisplay,
} from './annualLeaveLabels'
import './LeaveWorkflowSteppers.css'

const SALARY_STEPS = [
  { id: 0, label: 'Not on this leave yet', sub: 'Save in calculator, then Apply here' },
  { id: 1, label: 'Applied to this leave', sub: 'Amount stored on request' },
  { id: 2, label: 'Sent to Payments', sub: 'When integration is on' },
  { id: 3, label: 'Payment completed', sub: 'Finance' },
]

function StepTrack({ title, steps, currentIdx, emptyMessage }) {
  if (emptyMessage) {
    return (
      <div className="alw-stepper alw-stepper--muted">
        <div className="alw-stepper__head">{title}</div>
        <p className="alw-stepper__na">{emptyMessage}</p>
      </div>
    )
  }
  if (currentIdx < 0) {
    return (
      <div className="alw-stepper alw-stepper--muted">
        <div className="alw-stepper__head">{title}</div>
        <p className="alw-stepper__na">Not applicable.</p>
      </div>
    )
  }
  return (
    <div className="alw-stepper" aria-label={title}>
      <div className="alw-stepper__head">{title}</div>
      <ol className="alw-stepper__track" role="list">
        {steps.map((s, i) => {
          const done = i < currentIdx
          const active = i === currentIdx
          return (
            <li
              key={s.id}
              className={`alw-step alw-step--${done ? 'done' : active ? 'active' : 'upcoming'}`}
            >
              <span className="alw-step__n">{i + 1}</span>
              <span className="alw-step__text">
                <span className="alw-step__label">{s.label}</span>
                {s.sub && <span className="alw-step__sub">{s.sub}</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function SalaryStepTrack({ row }) {
  if (row.status === 'Pending' || row.status === 'Rejected') {
    return (
      <div className="alw-stepper alw-stepper--muted">
        <div className="alw-stepper__head">Salary and payment</div>
        <p className="alw-stepper__na">Relevant after the leave is approved and the main shop flow starts.</p>
      </div>
    )
  }
  const hasApplied = row.calculated_leave_amount != null
  const currentIdx = hasApplied ? 1 : 0
  return (
    <div className="alw-stepper" aria-label="Salary and payment">
      <div className="alw-stepper__head">Salary and payment</div>
      <ol className="alw-stepper__track" role="list">
        {SALARY_STEPS.map((s, i) => {
          if (i >= 2) {
            return (
              <li key={s.id} className="alw-step alw-step--future">
                <span className="alw-step__n">{i + 1}</span>
                <span className="alw-step__text">
                  <span className="alw-step__label">{s.label}</span>
                  {s.sub && <span className="alw-step__sub">{s.sub}</span>}
                </span>
              </li>
            )
          }
          const done = hasApplied && i < currentIdx
          const active = i === currentIdx
          return (
            <li
              key={s.id}
              className={`alw-step alw-step--${done ? 'done' : active ? 'active' : 'upcoming'}`}
            >
              <span className="alw-step__n">{i + 1}</span>
              <span className="alw-step__text">
                <span className="alw-step__label">{s.label}</span>
                {s.sub && <span className="alw-step__sub">{s.sub}</span>}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="alw-footnote">“Sent to Payments” and “Payment completed” use Management → Payments when that API is connected.</p>
    </div>
  )
}

export function LeaveWorkflowSteppers({ row }) {
  const es = row.effective_status || row.status
  const li = leaveRequestStepperIndex(es)
  const lRejected = es === 'Rejected'
  const si = row.status === 'Approved' ? shopVisitStepperIndex(row.shop_visit_status, row.status) : -1

  return (
    <div className="alw-stepper-grid">
      {lRejected ? (
        <div className="alw-stepper alw-stepper--rejected">
          <div className="alw-stepper__head">Leave request</div>
          <p>
            <strong>Rejected</strong> — this request is closed.
          </p>
        </div>
      ) : (
        <div className="alw-stepper" aria-label="Leave request">
          <div className="alw-stepper__head">Leave request</div>
          <p className="alw-stepper__summary">
            Status: <strong>{leaveStatusDisplay(es)}</strong> · Submitted {fmtDMY(row.created_at)}
          </p>
          <ol className="alw-stepper__track" role="list">
            {LEAVE_REQUEST_STEPS.map((s, i) => {
              const done = i < li
              const active = i === li
              return (
                <li
                  key={s.id}
                  className={`alw-step alw-step--${done ? 'done' : active ? 'active' : 'upcoming'}`}
                >
                  <span className="alw-step__n">{i + 1}</span>
                  <span className="alw-step__text">
                    <span className="alw-step__label">{s.label}</span>
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      <StepTrack
        title="Main shop visit"
        steps={SHOP_WORKFLOW_STEPS}
        currentIdx={row.status === 'Approved' ? si : -1}
        emptyMessage={row.status !== 'Approved' ? 'Applies only after the leave is approved (passport / money at main shop).' : null}
      />

      <SalaryStepTrack row={row} />
    </div>
  )
}
