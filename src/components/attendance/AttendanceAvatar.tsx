import type { ComponentType } from 'react'
import { EmployeeAvatar } from '../employees/EmployeeAvatar'

interface AvatarProps {
  name: string
  photoUrl?: string | null
  employeeId?: string
  size?: 'sm' | 'md'
}

/** Typed handle on the shared (JS) employee avatar: photo with initials fallback when missing or broken. */
export const AttendanceAvatar = EmployeeAvatar as unknown as ComponentType<AvatarProps>
