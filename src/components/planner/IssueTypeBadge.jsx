/**
 * IssueTypeBadge.jsx
 * Shows an icon + coloured pill label for a given issue type.
 */
import { Bug, Star, Zap, BookOpen, Layers, GitBranch, Rocket, Search, Wrench, HeadphonesIcon, CheckSquare } from 'lucide-react'

const CONFIG = {
  task:        { label: 'Task',        Icon: CheckSquare,      color: 'blue'   },
  bug:         { label: 'Bug',         Icon: Bug,              color: 'red'    },
  story:       { label: 'Story',       Icon: BookOpen,         color: 'green'  },
  feature:     { label: 'Feature',     Icon: Star,             color: 'purple' },
  epic:        { label: 'Epic',        Icon: Layers,           color: 'indigo' },
  subtask:     { label: 'Subtask',     Icon: GitBranch,        color: 'gray'   },
  improvement: { label: 'Improvement', Icon: Wrench,           color: 'teal'   },
  research:    { label: 'Research',    Icon: Search,           color: 'amber'  },
  deployment:  { label: 'Deployment',  Icon: Rocket,           color: 'orange' },
  support:     { label: 'Support',     Icon: HeadphonesIcon,   color: 'pink'   },
}

const COLOR_CLASSES = {
  blue:   'itb--blue',
  red:    'itb--red',
  green:  'itb--green',
  purple: 'itb--purple',
  indigo: 'itb--indigo',
  gray:   'itb--gray',
  teal:   'itb--teal',
  amber:  'itb--amber',
  orange: 'itb--orange',
  pink:   'itb--pink',
}

export function IssueTypeBadge({ type = 'task', showLabel = false, size = 14 }) {
  const cfg = CONFIG[String(type).toLowerCase()] || CONFIG.task
  const { Icon, label, color } = cfg
  return (
    <span className={`itb ${COLOR_CLASSES[color] || 'itb--blue'}`} title={label}>
      <Icon size={size} strokeWidth={2} aria-hidden="true" />
      {showLabel && <span className="itb__label">{label}</span>}
    </span>
  )
}

export { CONFIG as ISSUE_TYPE_CONFIG }
export default IssueTypeBadge
