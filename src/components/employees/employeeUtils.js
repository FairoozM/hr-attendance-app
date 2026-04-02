/** Prefer explicit HR joining date, else record created_at. */
export function effectiveJoiningDate(emp) {
  if (!emp) return null
  return emp.joiningDate || emp.createdAt || null
}

/** @param {string|null|undefined} iso */
export function formatJoiningDate(iso) {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return null
  }
}

export function displayOrDash(v) {
  if (v == null || String(v).trim() === '') return '—'
  return String(v).trim()
}

/** @param {string} name */
export function employmentStatusLabel(status) {
  const m = {
    active: 'Active',
    inactive: 'Inactive',
    on_leave: 'On leave',
    resigned: 'Resigned',
  }
  return m[status] || '—'
}

export function initialsFromName(name) {
  if (!name || typeof name !== 'string') return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
