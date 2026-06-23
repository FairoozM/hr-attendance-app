import type { ReactNode } from 'react'
import { CLEARING_STEPS, STEP_STATUS_LABEL, type ClearingStep, type StepStatus } from '../clearingSteps'

function StepStatusBadge({ status }: { status: StepStatus }) {
  return <span className={`apc-step-badge apc-step-badge--${status}`}>{STEP_STATUS_LABEL[status]}</span>
}

export function ClearingStepper({
  activeStep,
  stepStatuses,
  onStepClick,
}: {
  activeStep: number
  stepStatuses: Record<number, StepStatus>
  onStepClick: (id: number) => void
}) {
  return (
    <nav className="apc-stepper" aria-label="Amazon KSA payment clearing workflow">
      <ol className="apc-stepper__list">
        {CLEARING_STEPS.map((step) => {
          const status = stepStatuses[step.id] || 'not_started'
          const isActive = activeStep === step.id
          const isClickable = status !== 'not_started' || isActive
          return (
            <li
              key={step.id}
              className={`apc-stepper__item apc-stepper__item--${status}${isActive ? ' apc-stepper__item--active' : ''}`}
            >
              <button
                type="button"
                className="apc-stepper__button"
                disabled={!isClickable}
                onClick={() => onStepClick(step.id)}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className="apc-stepper__index">{step.id}</span>
                <span className="apc-stepper__text">
                  <span className="apc-stepper__title">{step.title}</span>
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

export function StepPanel({
  step,
  status,
  blocker,
  children,
  collapsed,
  onExpand,
  summary,
  id,
  actions,
}: {
  step: ClearingStep
  status: StepStatus
  blocker?: string
  children: ReactNode
  collapsed: boolean
  onExpand: () => void
  summary?: ReactNode
  id?: string
  actions?: ReactNode
}) {
  if (collapsed) {
    return (
      <section id={id} className="apc-step-panel apc-step-panel--collapsed">
        <div className="apc-step-panel__collapsed-head">
          <div>
            <h2>
              <span className="apc-step-panel__step-num">Step {step.id}</span> {step.title}
            </h2>
            <StepStatusBadge status={status} />
            {summary ? <p className="apc-step-panel__summary">{summary}</p> : null}
          </div>
          <button type="button" className="ainv-btn ainv-btn--sm" onClick={onExpand}>
            Open step
          </button>
        </div>
      </section>
    )
  }

  return (
    <section id={id} className="apc-step-panel apc-step-panel--active">
      <header className="apc-step-panel__head">
        <div>
          <p className="apc-step-panel__eyebrow">Step {step.id} of {CLEARING_STEPS.length}</p>
          <h2>{step.title}</h2>
          <p className="apc-step-panel__desc">{step.description}</p>
          <div className="apc-step-panel__status-row">
            <StepStatusBadge status={status} />
            {blocker && status === 'blocked' ? <span className="apc-step-panel__blocker">{blocker}</span> : null}
          </div>
        </div>
        {actions ? <div className="apc-step-panel__actions">{actions}</div> : null}
      </header>
      <div className="apc-step-panel__body">{children}</div>
    </section>
  )
}
