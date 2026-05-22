/**
 * TaskFiltersBar.jsx
 * Jira-style filter toolbar for the Team Projects page.
 */
import { Search, X, SlidersHorizontal, User, Filter } from 'lucide-react'
import { ModernSelect } from '../ui/ModernSelect'
import { ModernSearchInput } from '../ui/ModernSearchInput'

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'Backlog',     label: 'Backlog'      },
  { value: 'To Do',       label: 'To Do'        },
  { value: 'In Progress', label: 'In Progress'  },
  { value: 'In Review',   label: 'In Review'    },
  { value: 'QA Testing',  label: 'QA Testing'   },
  { value: 'Blocked',     label: 'Blocked'      },
  { value: 'Done',        label: 'Done'         },
  { value: 'Cancelled',   label: 'Cancelled'    },
]

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'Critical', label: 'Critical' },
  { value: 'High',     label: 'High'     },
  { value: 'Medium',   label: 'Medium'   },
  { value: 'Low',      label: 'Low'      },
]

const ISSUE_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'task',        label: 'Task'        },
  { value: 'bug',         label: 'Bug'         },
  { value: 'story',       label: 'Story'       },
  { value: 'feature',     label: 'Feature'     },
  { value: 'epic',        label: 'Epic'        },
  { value: 'subtask',     label: 'Subtask'     },
  { value: 'improvement', label: 'Improvement' },
  { value: 'research',    label: 'Research'    },
  { value: 'deployment',  label: 'Deployment'  },
  { value: 'support',     label: 'Support'     },
]

export function TaskFiltersBar({
  filters,
  onChange,
  projects    = [],
  members     = [],
  sprints     = [],
  currentUser = null,
}) {
  function set(key, val) {
    onChange({ ...filters, [key]: val })
  }

  function clearAll() {
    onChange({
      search:      '',
      projectId:   '',
      assigneeId:  '',
      status:      '',
      priority:    '',
      issueType:   '',
      sprintId:    '',
      label:       '',
      overdueOnly: false,
      blockedOnly: false,
      myTasks:     false,
      unassigned:  false,
    })
  }

  const hasActiveFilters =
    filters.search      ||
    filters.projectId   ||
    filters.assigneeId  ||
    filters.status      ||
    filters.priority    ||
    filters.issueType   ||
    filters.sprintId    ||
    filters.label       ||
    filters.overdueOnly ||
    filters.blockedOnly ||
    filters.myTasks     ||
    filters.unassigned

  const projectOptions = [
    { value: '', label: 'All Projects' },
    ...projects.map((p) => ({ value: String(p.id), label: p.name })),
  ]

  const assigneeOptions = [
    { value: '', label: 'All Assignees' },
    ...members.map((m) => ({
      value: String(m.id),
      label: m.displayName || m.username,
    })),
  ]

  const sprintOptions = [
    { value: '', label: 'All Sprints' },
    ...sprints.map((s) => ({ value: String(s.id), label: s.name })),
  ]

  return (
    <div className="tfb-wrap">
      {/* Row 1: Search + quick toggles */}
      <div className="tfb-row tfb-row--primary">
        <ModernSearchInput
          value={filters.search}
          onChange={(v) => set('search', v)}
          placeholder="Search tasks, projects, assignees…"
          className="tfb-search"
        />

        {/* Quick toggle pills */}
        <div className="tfb-toggles">
          {currentUser && (
            <button
              type="button"
              className={`tfb-toggle ${filters.myTasks ? 'tfb-toggle--on' : ''}`}
              onClick={() => set('myTasks', !filters.myTasks)}
            >
              <User size={12} aria-hidden="true" /> My Tasks
            </button>
          )}
          <button
            type="button"
            className={`tfb-toggle ${filters.unassigned ? 'tfb-toggle--on' : ''}`}
            onClick={() => set('unassigned', !filters.unassigned)}
          >
            Unassigned
          </button>
          <button
            type="button"
            className={`tfb-toggle tfb-toggle--overdue ${filters.overdueOnly ? 'tfb-toggle--on' : ''}`}
            onClick={() => set('overdueOnly', !filters.overdueOnly)}
          >
            Overdue
          </button>
          <button
            type="button"
            className={`tfb-toggle tfb-toggle--blocked ${filters.blockedOnly ? 'tfb-toggle--on' : ''}`}
            onClick={() => set('blockedOnly', !filters.blockedOnly)}
          >
            Blocked
          </button>
        </div>

        {hasActiveFilters && (
          <button type="button" className="tfb-clear" onClick={clearAll} title="Clear all filters">
            <X size={13} aria-hidden="true" /> Clear
          </button>
        )}
      </div>

      {/* Row 2: Dropdowns */}
      <div className="tfb-row tfb-row--dropdowns">
        <ModernSelect
          value={filters.projectId}
          onChange={(v) => set('projectId', v)}
          options={projectOptions}
          placeholder="Project"
          size="sm"
        />
        <ModernSelect
          value={filters.assigneeId}
          onChange={(v) => set('assigneeId', v)}
          options={assigneeOptions}
          placeholder="Assignee"
          size="sm"
        />
        <ModernSelect
          value={filters.status}
          onChange={(v) => set('status', v)}
          options={STATUS_OPTIONS}
          placeholder="Status"
          size="sm"
        />
        <ModernSelect
          value={filters.priority}
          onChange={(v) => set('priority', v)}
          options={PRIORITY_OPTIONS}
          placeholder="Priority"
          size="sm"
        />
        <ModernSelect
          value={filters.issueType}
          onChange={(v) => set('issueType', v)}
          options={ISSUE_TYPE_OPTIONS}
          placeholder="Type"
          size="sm"
        />
        {sprints.length > 0 && (
          <ModernSelect
            value={filters.sprintId}
            onChange={(v) => set('sprintId', v)}
            options={sprintOptions}
            placeholder="Sprint"
            size="sm"
          />
        )}
      </div>
    </div>
  )
}

export default TaskFiltersBar
