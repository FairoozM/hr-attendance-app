/**
 * IssueListGroup.jsx
 * Collapsible group header + list of IssueRow items.
 * Used for status-grouped, priority-grouped, assignee-grouped views.
 */
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { IssueRow } from './IssueRow'

export function IssueListGroup({
  title,
  titleColor,
  titleIcon: TitleIcon,
  issues = [],
  projectMap = {},
  memberMap  = {},
  selectedId,
  onSelect,
  onStatusChange,
  onPriorityChange,
  defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="ilg">
      {/* Group header */}
      <button
        type="button"
        className="ilg__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronRight
          size={13}
          strokeWidth={2.2}
          className={`ilg__chevron ${open ? 'ilg__chevron--open' : ''}`}
          aria-hidden="true"
        />
        {TitleIcon && (
          <TitleIcon
            size={13}
            strokeWidth={open ? 2.2 : 1.8}
            style={{ color: titleColor || 'currentColor', flexShrink: 0 }}
            aria-hidden="true"
          />
        )}
        <span className="ilg__title" style={titleColor ? { color: titleColor } : {}}>
          {title}
        </span>
        <span className="ilg__count">{issues.length}</span>
      </button>

      {/* Issue rows */}
      {open && issues.length > 0 && (
        <div className="ilg__items" role="rowgroup">
          {issues.map((issue) => (
            <IssueRow
              key={`${issue.projectId}-${issue.id}`}
              issue={issue}
              project={projectMap[issue.projectId] || null}
              member={issue.assigneeUserId ? memberMap[issue.assigneeUserId] : null}
              isSelected={selectedId === issue.id}
              onSelect={onSelect}
              onStatusChange={onStatusChange}
              onPriorityChange={onPriorityChange}
            />
          ))}
        </div>
      )}

      {open && issues.length === 0 && (
        <div className="ilg__empty">No issues</div>
      )}
    </section>
  )
}

export default IssueListGroup
