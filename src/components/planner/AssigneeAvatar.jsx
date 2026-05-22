/**
 * AssigneeAvatar.jsx
 * Single assignee display: avatar + name or "Unassigned" state.
 */
import { UserCircle2 } from 'lucide-react'

function initials(name = '') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('')
}

/** Deterministic hue from a string */
function hueFromString(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff
  return Math.abs(h) % 360
}

export function AssigneeAvatar({
  member,        // { id, displayName, avatarUrl, ... }
  size = 'sm',   // 'xs' | 'sm' | 'md'
  showName = false,
  showUnassigned = true,
}) {
  if (!member) {
    if (!showUnassigned) return null
    return (
      <span className={`aa-wrap aa-wrap--${size} aa-wrap--unassigned`} title="Unassigned">
        <UserCircle2 size={size === 'xs' ? 12 : size === 'sm' ? 16 : 20} strokeWidth={1.6} className="aa-unassigned-icon" aria-hidden="true" />
        {showName && <span className="aa-name aa-name--unassigned">Unassigned</span>}
      </span>
    )
  }

  const name = member.displayName || member.username || ''
  const hue  = hueFromString(name)

  return (
    <span className={`aa-wrap aa-wrap--${size}`} title={name}>
      {member.avatarUrl ? (
        <img
          src={member.avatarUrl}
          alt={name}
          className={`aa-img aa-img--${size}`}
          onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }}
        />
      ) : null}
      <span
        className={`aa-fallback aa-fallback--${size}`}
        style={{ '--aa-hue': hue, display: member.avatarUrl ? 'none' : 'flex' }}
        aria-hidden="true"
      >
        {initials(name) || '?'}
      </span>
      {showName && <span className="aa-name">{name}</span>}
    </span>
  )
}

export default AssigneeAvatar
