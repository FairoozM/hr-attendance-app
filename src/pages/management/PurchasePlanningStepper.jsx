import { PP_STEPS } from './purchasePlanningUtils'
import { StepStatusBadge } from './PurchasePlanningBadges'

export function PurchasePlanningStepper({ activeStep, stepStatuses, onStepClick }) {
  return (
    <nav className="pp-stepper" aria-label="Purchase planning workflow">
      <ol className="pp-stepper__list">
        {PP_STEPS.map((step) => {
          const status = stepStatuses[step.id] || 'not_started'
          const isActive = activeStep === step.id
          const isClickable = status === 'completed' || status === 'ready' || status === 'in_progress' || isActive
          return (
            <li
              key={step.id}
              className={`pp-stepper__item pp-stepper__item--${status}${isActive ? ' pp-stepper__item--active' : ''}`}
            >
              <button
                type="button"
                className="pp-stepper__button"
                disabled={!isClickable && !isActive}
                onClick={() => onStepClick(step.id)}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className="pp-stepper__index">{step.id}</span>
                <span className="pp-stepper__text">
                  <span className="pp-stepper__title">{step.title}</span>
                  <StepStatusBadge status={status} />
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
