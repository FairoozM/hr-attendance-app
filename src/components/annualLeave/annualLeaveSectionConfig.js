export const ANNUAL_LEAVE_SECTIONS = [
  { key: 'NeedsAction', label: 'Needs action' },
  { key: 'Ongoing', label: 'Active leave' },
  { key: 'Approved', label: 'Upcoming approved' },
  { key: 'Completed', label: 'Leave completed' },
  { key: 'Rejected', label: 'Rejected / archived' },
]

const DOT = {
  Pending: '#f59e0b',
  Ongoing: '#8b5cf6',
  ReturnPending: '#f97316',
  Overstayed: '#ef4444',
  Approved: '#3b82f6',
  Completed: '#22c55e',
  Rejected: '#9ca3af',
  NeedsAction: '#6366f1',
}

export function sectionHeadDot(sectionKey) {
  return DOT[sectionKey] || '#6366f1'
}
