import { StepStatusBadge } from './PurchasePlanningBadges'
import { PP_STEPS } from './purchasePlanningUtils'

const STATUS_LABELS = {
  not_started: 'Not started',
  ready: 'Ready',
  in_progress: 'In progress',
  completed: 'Done',
  blocked: 'Locked',
  error: 'Needs attention',
}

export function PurchasePlanningStepper({ activeStep, stepStatuses, blockers = {}, onStepClick }) {
  return (
    <nav className="pp-stepper" aria-label="Purchase planning workflow">
      <ol className="pp-stepper__list">
        {PP_STEPS.map((step) => {
          const status = stepStatuses[step.id] || 'not_started'
          const isActive = activeStep === step.id
          const isClickable =
            isActive || status === 'completed' || status === 'ready' || status === 'in_progress' || status === 'error'
          const detail = blockers[step.id] || STATUS_LABELS[status] || status
          return (
            <li
              key={step.id}
              className={`pp-stepper__item pp-stepper__item--${status}${isActive ? ' pp-stepper__item--active' : ''}`}
            >
              <button
                type="button"
                className="pp-stepper__button"
                disabled={!isClickable}
                onClick={() => onStepClick(step.id)}
                aria-current={isActive ? 'step' : undefined}
                title={detail}
              >
                <span className="pp-stepper__index" aria-hidden>
                  {status === 'completed' ? '✓' : step.id}
                </span>
                <span className="pp-stepper__text">
                  <span className="pp-stepper__title">{step.shortTitle || step.title}</span>
                  <span className={`pp-stepper__status pp-stepper__status--${status}`}>{STATUS_LABELS[status] || status}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function StepPanel({ step, status, blocker, children, collapsed, onExpand, summary, id }) {
  if (collapsed) {
    return (
      <section id={id} className="pp-step-panel pp-step-panel--collapsed">
        <div className="pp-step-panel__collapsed-head">
          <div>
            <h2>
              <span className="pp-step-panel__step-num">Step {step.id}</span> {step.title}
            </h2>
            <StepStatusBadge status={status} />
            {summary && <p className="pp-step-panel__summary">{summary}</p>}
          </div>
          <button type="button" className="btn btn--sm" onClick={onExpand}>
            Open step
          </button>
        </div>
      </section>
    )
  }

  return (
    <section id={id} className="pp-step-panel pp-step-panel--active">
      <header className="pp-step-panel__head">
        <div>
          <p className="pp-step-panel__eyebrow">Step {step.id} of 6</p>
          <h2>{step.title}</h2>
          <p className="pp-step-panel__desc">{step.description}</p>
          <div className="pp-step-panel__status-row">
            <StepStatusBadge status={status} />
            {blocker && status === 'blocked' && <span className="pp-step-panel__blocker">{blocker}</span>}
          </div>
        </div>
      </header>
      <div className="pp-step-panel__body">{children}</div>
    </section>
  )
}
