import type { ReactNode } from 'react'
import { CLEARING_STEPS, STEP_STATUS_LABEL, type ClearingStep, type StepStatus } from '../clearingSteps'

function StepStatusBadge({ status }: { status: StepStatus }) {
  return <span className={`npc-step-badge npc-step-badge--${status}`}>{STEP_STATUS_LABEL[status]}</span>
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
    <nav className="npc-stepper" aria-label="Noon payment clearance workflow">
      <ol className="npc-stepper__list">
        {CLEARING_STEPS.map((step) => {
          const status = stepStatuses[step.id] || 'not_started'
          const isActive = activeStep === step.id
          const isClickable = status !== 'not_started' || isActive
          return (
            <li
              key={step.id}
              className={`npc-stepper__item npc-stepper__item--${status}${isActive ? ' npc-stepper__item--active' : ''}`}
            >
              <button
                type="button"
                className="npc-stepper__button"
                disabled={!isClickable}
                onClick={() => onStepClick(step.id)}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className="npc-stepper__index">{step.id}</span>
                <span className="npc-stepper__text">
                  <span className="npc-stepper__title">{step.title}</span>
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
      <section id={id} className="npc-step-panel npc-step-panel--collapsed">
        <div className="npc-step-panel__collapsed-head">
          <div>
            <h2>
              <span className="npc-step-panel__step-num">Step {step.id}</span> {step.title}
            </h2>
            <StepStatusBadge status={status} />
            {summary ? <p className="npc-step-panel__summary">{summary}</p> : null}
          </div>
          <button type="button" className="ainv-btn ainv-btn--sm" onClick={onExpand}>
            Open step
          </button>
        </div>
      </section>
    )
  }

  return (
    <section id={id} className="npc-step-panel npc-step-panel--active">
      <header className="npc-step-panel__head">
        <div>
          <p className="npc-step-panel__eyebrow">
            Step {step.id} of {CLEARING_STEPS.length}
          </p>
          <h2>{step.title}</h2>
          <p className="npc-step-panel__desc">{step.description}</p>
          <div className="npc-step-panel__status-row">
            <StepStatusBadge status={status} />
            {blocker && status === 'blocked' ? <span className="npc-step-panel__blocker">{blocker}</span> : null}
          </div>
        </div>
        {actions ? <div className="npc-step-panel__actions">{actions}</div> : null}
      </header>
      <div className="npc-step-panel__body">{children}</div>
    </section>
  )
}
