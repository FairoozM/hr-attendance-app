import { useMemo } from 'react'
import type { AttendancePendingActionItem } from '../../types/attendance'
import { fmtDMY } from '../../utils/dateFormat'

type LeaveRow = {
  id: number
  employee_id: number
  from_date: string
  to_date: string
  status: string
  reason?: string | null
}

export function useAttendancePendingActions(requests: LeaveRow[]): AttendancePendingActionItem[] {
  return useMemo(() => {
    return requests
      .filter((r) => r.status === 'Pending')
      .slice(0, 20)
      .map((r) => ({
        id: `leave-${r.id}`,
        type: 'approval' as const,
        label: `Annual leave approval #${r.id}`,
        meta: `${fmtDMY(r.from_date)} → ${fmtDMY(r.to_date)}`,
      }))
  }, [requests])
}
