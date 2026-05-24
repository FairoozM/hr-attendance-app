/**
 * IssueProperties — sidebar fields for the issue detail panel.
 */
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  ISSUE_TYPE_CONFIG,
  normalizeStatus,
  normalizePriority,
} from './IssueRow'
import { LabelPicker } from './LabelPicker'
import { normalizeLabels } from './linearLabels'

const STATUS_OPTIONS = Object.entries(STATUS_CONFIG).map(([value, c]) => ({
  value,
  label: c.label,
}))

const PRIORITY_OPTIONS = Object.entries(PRIORITY_CONFIG).map(([value, c]) => ({
  value,
  label: c.label,
}))

const ISSUE_TYPE_OPTIONS = [
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'ux/ui', label: 'UX/UI' },
  { value: 'performance', label: 'Performance' },
  { value: 'scalability', label: 'Scalability' },
  { value: 'release', label: 'Release' },
  { value: 'content', label: 'Content' },
  { value: 'integration', label: 'Integration' },
  { value: 'task', label: 'General' },
]

function FieldRow({ label, children }) {
  return (
    <div className="ipr__row">
      <span className="ipr__label">{label}</span>
      <div className="ipr__control">{children}</div>
    </div>
  )
}

function SelectField({ value, onChange, options, disabled }) {
  return (
    <select
      className="ipr__select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function IssueProperties({
  status,
  priority,
  issueType,
  assigneeUserId,
  labels,
  sprintId,
  cycles = [],
  dueDate,
  storyPoints,
  blockedReason,
  projectName,
  members = [],
  onChange,
  saving = false,
}) {
  const statusVal   = normalizeStatus(status)
  const priorityVal = normalizePriority(priority)
  const typeVal     = String(issueType || 'task').toLowerCase()
  const labelArr    = normalizeLabels(labels)

  return (
    <div className="ipr">
      <FieldRow label="Status">
        <SelectField
          value={statusVal}
          onChange={(v) => onChange({ status: v })}
          options={STATUS_OPTIONS}
          disabled={saving}
        />
      </FieldRow>

      <FieldRow label="Priority">
        <SelectField
          value={priorityVal}
          onChange={(v) => onChange({ priority: v })}
          options={PRIORITY_OPTIONS}
          disabled={saving}
        />
      </FieldRow>

      <FieldRow label="Type">
        <SelectField
          value={typeVal}
          onChange={(v) => onChange({ issueType: v })}
          options={ISSUE_TYPE_OPTIONS}
          disabled={saving}
        />
      </FieldRow>

      <FieldRow label="Assignee">
        <select
          className="ipr__select"
          value={assigneeUserId ? String(assigneeUserId) : ''}
          onChange={(e) => onChange({
            assigneeUserId: e.target.value ? Number(e.target.value) : null,
          })}
          disabled={saving}
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.displayName || m.username}
            </option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="Cycle">
        <select
          className="ipr__select"
          value={sprintId != null ? String(sprintId) : ''}
          onChange={(e) => onChange({
            sprintId: e.target.value ? Number(e.target.value) : null,
          })}
          disabled={saving}
        >
          <option value="">No Cycle</option>
          {cycles.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}{c.status === 'active' ? ' ●' : c.status === 'completed' ? ' ✓' : ''}
            </option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="Project">
        <span className="ipr__readonly" title={projectName || '—'}>
          {projectName || '—'}
        </span>
      </FieldRow>

      <FieldRow label="Due date">
        <input
          type="date"
          className="ipr__input"
          value={dueDate ? String(dueDate).slice(0, 10) : ''}
          onChange={(e) => onChange({ dueDate: e.target.value || null })}
          disabled={saving}
        />
      </FieldRow>

      <FieldRow label="Story points">
        <input
          type="number"
          min="0"
          max="99"
          className="ipr__input ipr__input--narrow"
          value={storyPoints ?? ''}
          onChange={(e) => {
            const v = e.target.value
            onChange({ storyPoints: v === '' ? null : Number(v) })
          }}
          placeholder="—"
          disabled={saving}
        />
      </FieldRow>

      <FieldRow label="Blocked reason">
        <input
          type="text"
          className="ipr__input"
          value={blockedReason || ''}
          onChange={(e) => onChange({ blockedReason: e.target.value })}
          placeholder="Why is this blocked?"
          disabled={saving}
        />
      </FieldRow>

      <div className="ipr__row ipr__row--labels">
        <span className="ipr__label">Labels</span>
        <div className="ipr__control">
          <LabelPicker
            labels={labelArr}
            onChange={(newLabels) => onChange({ labels: newLabels })}
            disabled={saving}
          />
        </div>
      </div>

      {/* Subtle type hint — only shown for non-default types */}
      {ISSUE_TYPE_CONFIG[typeVal] && typeVal !== 'task' && (
        <p className="ipr__hint">
          {ISSUE_TYPE_CONFIG[typeVal].label}
        </p>
      )}
    </div>
  )
}

export default IssueProperties
