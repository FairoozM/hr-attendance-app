import { minutesToTime, CATEGORY_META, ENERGY_META } from '../../lib/aiEngine'
import { CategoryBadge } from './CategoryBadge'

function WorkloadBar({ plan }) {
  const deep    = plan.filter(b => b.slot === 'morning').length
  const shallow = plan.filter(b => b.slot === 'afternoon').length
  const blocked = plan.filter(b => b.slot === 'blocked').length
  const total   = deep + shallow + blocked || 1

  return (
    <div className="ai-schedule-workload">
      <div className="ai-schedule-workload__bar">
        <div className="ai-schedule-workload__seg ai-schedule-workload__seg--deep"    style={{ width: `${(deep / total) * 100}%` }} title={`${deep} deep work`} />
        <div className="ai-schedule-workload__seg ai-schedule-workload__seg--shallow" style={{ width: `${(shallow / total) * 100}%` }} title={`${shallow} shallow work`} />
        <div className="ai-schedule-workload__seg ai-schedule-workload__seg--blocked" style={{ width: `${(blocked / total) * 100}%` }} title={`${blocked} blocked`} />
      </div>
      <div className="ai-schedule-workload__labels">
        {deep > 0    && <span>🧠 {deep} deep</span>}
        {shallow > 0 && <span>⚡ {shallow} shallow</span>}
        {blocked > 0 && <span>🚫 {blocked} blocked</span>}
      </div>
    </div>
  )
}

function ScheduleBlock({ block, index }) {
  const { task, startMinutes, endMinutes, slot } = block
  const catMeta    = CATEGORY_META[task.category] || CATEGORY_META.Admin
  const energyMeta = ENERGY_META[task.energyType]  || ENERGY_META['Shallow Work']
  const duration   = endMinutes - startMinutes

  return (
    <div
      className={`ai-schedule-block ai-schedule-block--${slot}`}
      style={{ '--cat-color': catMeta.color, '--cat-bg': catMeta.bg }}
    >
      <div className="ai-schedule-block__time">
        <span className="ai-schedule-block__start">{minutesToTime(startMinutes)}</span>
        <div className="ai-schedule-block__line" aria-hidden />
        <span className="ai-schedule-block__end">{minutesToTime(endMinutes)}</span>
      </div>

      <div className="ai-schedule-block__card">
        <div className="ai-schedule-block__header">
          <span className="ai-schedule-block__index">{index + 1}</span>
          <span className="ai-schedule-block__title">{task.title}</span>
          <span
            className="ai-schedule-block__energy"
            style={{ color: energyMeta.color, background: energyMeta.bg }}
          >
            {task.energyType === 'Deep Work' ? '🧠' : '⚡'} {energyMeta.label}
          </span>
        </div>

        {task.description && (
          <p className="ai-schedule-block__desc">{task.description}</p>
        )}

        <div className="ai-schedule-block__meta">
          <CategoryBadge category={task.category} />
          <span className="ai-schedule-block__duration">
            {duration >= 60
              ? `${Math.floor(duration / 60)}h ${duration % 60 > 0 ? `${duration % 60}m` : ''}`
              : `${duration}m`}
          </span>
          {task.priorityScore >= 50 && (
            <span className="ai-schedule-block__fire">
              {'🔥'.repeat(task.priorityScore >= 75 ? 3 : task.priorityScore >= 50 ? 2 : 1)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function DailyScheduleView({ plan = [], date = new Date() }) {
  const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const morningBlocks   = plan.filter(b => b.slot === 'morning')
  const afternoonBlocks = plan.filter(b => b.slot === 'afternoon')
  const blockedBlocks   = plan.filter(b => b.slot === 'blocked')

  if (plan.length === 0) {
    return (
      <div className="ai-schedule-empty">
        <div className="ai-schedule-empty__icon" aria-hidden>🎉</div>
        <div className="ai-schedule-empty__title">Nothing scheduled today</div>
        <div className="ai-schedule-empty__sub">Add tasks to auto-generate your daily plan</div>
      </div>
    )
  }

  return (
    <div className="ai-schedule">
      <div className="ai-schedule__date">{dateLabel}</div>
      <WorkloadBar plan={plan} />

      {morningBlocks.length > 0 && (
        <div className="ai-schedule__section">
          <div className="ai-schedule__section-label">🧠 Morning Deep Work · 09:00 – 12:00</div>
          {morningBlocks.map((b, i) => <ScheduleBlock key={b.task.id ?? i} block={b} index={i} />)}
        </div>
      )}

      {afternoonBlocks.length > 0 && (
        <div className="ai-schedule__section">
          <div className="ai-schedule__section-label">⚡ Afternoon Shallow Work · 13:00 – 17:00</div>
          {afternoonBlocks.map((b, i) => <ScheduleBlock key={b.task.id ?? i} block={b} index={i} />)}
        </div>
      )}

      {blockedBlocks.length > 0 && (
        <div className="ai-schedule__section">
          <div className="ai-schedule__section-label ai-schedule__section-label--blocked">🚫 Blocked — Resolve Dependencies</div>
          {blockedBlocks.map((b, i) => <ScheduleBlock key={b.task.id ?? i} block={b} index={i} />)}
        </div>
      )}
    </div>
  )
}
