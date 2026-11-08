import type { ReactNode } from 'react'
import { StepStatusBadge } from './PurchasePlanningBadges'
import type { StepBlockers, StepDefinition, StepId, StepStatus, StepStatuses } from './purchasePlanningTypes'
import { PP_STEPS, STEP_STATUS_LABELS } from './purchasePlanningUtils'

const CLICKABLE_STATUSES: StepStatus[] = ['completed', 'ready', 'in_progress', 'error']

interface StepperProps {
  activeStep: StepId
  stepStatuses: StepStatuses
  blockers?: StepBlockers
  onStepClick: (stepId: StepId) => void
}

export function PurchasePlanningStepper({ activeStep, stepStatuses, blockers = {}, onStepClick }: StepperProps) {
  return (
    <nav className="pp-stepper" aria-label="Purchase planning workflow">
      <ol className="pp-stepper__list">
        {PP_STEPS.map((step) => {
          const status = stepStatuses[step.id] || 'not_started'
          const isActive = activeStep === step.id
          const isClickable = isActive || CLICKABLE_STATUSES.includes(status)
          const label = STEP_STATUS_LABELS[status] || status
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
                title={blockers[step.id] || label}
              >
                <span className="pp-stepper__index" aria-hidden>
                  {status === 'completed' ? '✓' : step.id}
                </span>
                <span className="pp-stepper__text">
                  <span className="pp-stepper__title">{step.shortTitle}</span>
                  <span className={`pp-stepper__status pp-stepper__status--${status}`}>{label}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

interface StepPanelProps {
  id: string
  step: StepDefinition
  status: StepStatus
  blocker?: string
  children: ReactNode
}

export function StepPanel({ id, step, status, blocker, children }: StepPanelProps) {
  return (
    <section id={id} className="pp-step-panel pp-step-panel--active">
      <header className="pp-step-panel__head">
        <div>
          <p className="pp-step-panel__eyebrow">Step {step.id} of {PP_STEPS.length}</p>
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
