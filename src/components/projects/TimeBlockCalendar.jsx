import { useState } from 'react'
import { minutesToTime, CATEGORY_META } from '../../lib/aiEngine'

const HOURS = Array.from({ length: 10 }, (_, i) => i + 8) // 08:00 – 17:00

function toMinutes(hour) { return hour * 60 }

function TaskPill({ block, onDrop, onClick }) {
  const { task, startMinutes, endMinutes } = block
  const duration = endMinutes - startMinutes
  const catMeta  = CATEGORY_META[task.category] || CATEGORY_META.Admin
  const isBlocked = task.is_blocked || task.status === 'Blocked'
  const isDone    = task.status === 'Done' || !!task.completed_at

  return (
    <div
      className={`ai-cal-pill${isBlocked ? ' ai-cal-pill--blocked' : ''}${isDone ? ' ai-cal-pill--done' : ''}`}
      style={{
        '--cat-color': catMeta.color,
        '--cat-bg':    catMeta.bg,
        height:        `${Math.max(28, duration * 0.9)}px`,
      }}
      title={`${task.title} · ${minutesToTime(startMinutes)}–${minutesToTime(endMinutes)}`}
      onClick={() => onClick && onClick(task)}
      draggable
      onDragStart={e => e.dataTransfer.setData('taskId', String(task.id))}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick && onClick(task)}
    >
      <span className="ai-cal-pill__icon" aria-hidden>{catMeta.icon}</span>
      <span className="ai-cal-pill__title">{task.title}</span>
      <span className="ai-cal-pill__time">{minutesToTime(startMinutes)}</span>
    </div>
  )
}

function HourRow({ hour, blocks, onDrop, onTaskClick, overloaded }) {
  const [dragOver, setDragOver] = useState(false)
  const start = toMinutes(hour)
  const end   = start + 60
  const rowBlocks = blocks.filter(b => b.startMinutes >= start && b.startMinutes < end)

  return (
    <div
      className={`ai-cal-row${overloaded ? ' ai-cal-row--overload' : ''}${dragOver ? ' ai-cal-row--dragover' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        const taskId = parseInt(e.dataTransfer.getData('taskId'))
        onDrop && onDrop(taskId, hour)
      }}
    >
      <div className="ai-cal-row__label">
        <span className="ai-cal-row__hour">{String(hour).padStart(2, '0')}:00</span>
        {overloaded && <span className="ai-cal-row__overload-badge" title="Overloaded slot">⚠️</span>}
      </div>
      <div className="ai-cal-row__content">
        {rowBlocks.map((b, i) => (
          <TaskPill key={b.task.id ?? i} block={b} onDrop={onDrop} onClick={onTaskClick} />
        ))}
        {rowBlocks.length === 0 && (
          <div className="ai-cal-row__empty" aria-hidden>Drop a task here</div>
        )}
      </div>
    </div>
  )
}

export function TimeBlockCalendar({ plan = [], onTaskDrop, onTaskClick }) {
  // Count blocks per hour
  const hourCounts = {}
  plan.forEach(b => {
    const h = Math.floor(b.startMinutes / 60)
    hourCounts[h] = (hourCounts[h] || 0) + 1
  })

  const deepBlocks    = plan.filter(b => b.slot === 'morning')
  const shallowBlocks = plan.filter(b => b.slot === 'afternoon')
  const blockedTasks  = plan.filter(b => b.slot === 'blocked')

  return (
    <div className="ai-calendar">
      {/* Legend */}
      <div className="ai-calendar__legend">
        <span className="ai-calendar__legend-item ai-calendar__legend-item--deep">🧠 Deep Work · 09–12</span>
        <span className="ai-calendar__legend-item ai-calendar__legend-item--shallow">⚡ Shallow Work · 13–17</span>
        {blockedTasks.length > 0 && (
          <span className="ai-calendar__legend-item ai-calendar__legend-item--blocked">🚫 Blocked · {blockedTasks.length}</span>
        )}
      </div>

      {/* Grid */}
      <div className="ai-calendar__grid">
        {HOURS.map(hour => (
          <HourRow
            key={hour}
            hour={hour}
            blocks={plan}
            onDrop={onTaskDrop}
            onTaskClick={onTaskClick}
            overloaded={(hourCounts[hour] || 0) > 2}
          />
        ))}
      </div>

      {/* Blocked tasks footer */}
      {blockedTasks.length > 0 && (
        <div className="ai-calendar__blocked">
          <span className="ai-calendar__blocked-label">🚫 Needs Unblocking</span>
          <div className="ai-calendar__blocked-list">
            {blockedTasks.map((b, i) => {
              const catMeta = CATEGORY_META[b.task.category] || CATEGORY_META.Admin
              return (
                <div
                  key={b.task.id ?? i}
                  className="ai-cal-pill ai-cal-pill--blocked"
                  style={{ '--cat-color': catMeta.color, '--cat-bg': catMeta.bg, height: '32px' }}
                  onClick={() => onTaskClick && onTaskClick(b.task)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && onTaskClick && onTaskClick(b.task)}
                >
                  <span className="ai-cal-pill__icon" aria-hidden>{catMeta.icon}</span>
                  <span className="ai-cal-pill__title">{b.task.title}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
