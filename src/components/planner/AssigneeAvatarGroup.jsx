/**
 * AssigneeAvatarGroup.jsx
 * Shows a stacked group of assignee avatars.
 * Currently used for single assignee_user_id; ready for multi-assignee in future phases.
 */
import { AssigneeAvatar } from './AssigneeAvatar'

export function AssigneeAvatarGroup({
  members = [],      // array of member objects
  max = 3,
  size = 'xs',
  showName = false,
  showUnassigned = true,
}) {
  if (!members || members.length === 0) {
    return <AssigneeAvatar member={null} size={size} showName={showName} showUnassigned={showUnassigned} />
  }

  const visible = members.slice(0, max)
  const overflow = members.length - max

  return (
    <span className="aag-wrap">
      {visible.map((m, i) => (
        <span key={m?.id ?? i} className="aag-slot" style={{ zIndex: visible.length - i }}>
          <AssigneeAvatar member={m} size={size} showUnassigned={false} />
        </span>
      ))}
      {overflow > 0 && (
        <span className="aag-overflow" title={`+${overflow} more`}>+{overflow}</span>
      )}
      {showName && members.length === 1 && (
        <span className="aa-name">{members[0]?.displayName || members[0]?.username || ''}</span>
      )}
    </span>
  )
}

export default AssigneeAvatarGroup
