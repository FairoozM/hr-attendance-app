import { memo } from 'react'
import { initialsFromName } from './employeeUtils'
import './EmployeeAvatar.css'

export const EmployeeAvatar = memo(function EmployeeAvatar({ name, photoUrl, size = 'md' }) {
  const initial = initialsFromName(name || '')

  const className = `employee-avatar employee-avatar--${size}${photoUrl ? ' employee-avatar--image' : ''}`

  if (photoUrl) {
    return (
      <span className={className}>
        <img src={photoUrl} alt="" className="employee-avatar__img" />
      </span>
    )
  }

  return (
    <span className={className} aria-hidden>
      <span className="employee-avatar__fallback">{initial}</span>
    </span>
  )
})
