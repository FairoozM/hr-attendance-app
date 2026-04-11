import type { AttendanceStatusCode } from '../../types/attendance'

/** Centralized status colors (aligned with app attendance constants) */
export const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  P: { bg: '#dcfce7', text: '#15803d', border: '#86efac' },
  A: { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca' },
  SL: { bg: '#ffedd5', text: '#c2410c', border: '#fed7aa' },
  AL: { bg: '#dbeafe', text: '#1d4ed8', border: '#93c5fd' },
  WH: { bg: '#f3e8ff', text: '#7c3aed', border: '#e9d5ff' },
  empty: { bg: '#f3f4f6', text: '#6b7280', border: '#e5e7eb' },
}

export function colorForStatus(status: AttendanceStatusCode | null | undefined) {
  if (!status) return STATUS_COLORS.empty
  return STATUS_COLORS[status] || STATUS_COLORS.empty
}
