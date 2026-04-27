export const ANNUAL_LEAVE_SECTIONS = [
  { key: 'Pending', label: 'Pending requests' },
  { key: 'Ongoing', label: 'On leave now' },
  { key: 'ReturnPending', label: 'Return pending' },
  { key: 'Overstayed', label: 'Overstayed / not returned' },
  { key: 'Approved', label: 'Approved / upcoming' },
  { key: 'Completed', label: 'Leave completed' },
  { key: 'Rejected', label: 'Rejected' },
]

const DOT = {
  Pending: '#f59e0b',
  Ongoing: '#8b5cf6',
  ReturnPending: '#f97316',
  Overstayed: '#ef4444',
  Approved: '#3b82f6',
  Completed: '#22c55e',
  Rejected: '#9ca3af',
}

export function sectionHeadDot(sectionKey) {
  return DOT[sectionKey] || '#6366f1'
}
