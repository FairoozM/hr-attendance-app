import { useMemo } from 'react'
import './DashboardCards.css'

function countByStatus(attendance, status) {
  return Object.values(attendance).reduce(
    (sum, days) => sum + Object.values(days).filter((s) => s === status).length,
    0
  )
}

export function DashboardCards({ employees, attendance, daysInMonth }) {
  const stats = useMemo(() => {
    const present = countByStatus(attendance, 'P')
    const absent = countByStatus(attendance, 'A')
    const sickLeave = countByStatus(attendance, 'SL')
    const annualLeave = countByStatus(attendance, 'AL')
    const weeklyHoliday = countByStatus(attendance, 'WH')
    const totalPossible = employees.length * daysInMonth
    const presentRate =
      totalPossible > 0 ? Math.round((present / totalPossible) * 100) : 0
    return {
      totalEmployees: employees.length,
      present,
      absent,
      sickLeave,
      annualLeave,
      weeklyHoliday,
      presentRate,
    }
  }, [employees.length, attendance, daysInMonth])

  const cards = [
    {
      title: 'Total Employees',
      value: stats.totalEmployees,
      variant: 'default',
    },
    {
      title: 'Present (P)',
      value: stats.present,
      variant: 'success',
    },
    {
      title: 'Absent (A)',
      value: stats.absent,
      variant: 'danger',
    },
    {
      title: 'Sick Leave (SL)',
      value: stats.sickLeave,
      variant: 'warning',
    },
    {
      title: 'Annual Leave (AL)',
      value: stats.annualLeave,
      variant: 'accent',
    },
    {
      title: 'Weekly Holiday (WH)',
      value: stats.weeklyHoliday,
      variant: 'weekly-holiday',
    },
    {
      title: 'Attendance Rate',
      value: `${stats.presentRate}%`,
      variant: 'primary',
    },
  ]

  return (
    <div className="dashboard-cards" role="region" aria-label="Attendance summary">
      {cards.map((card) => (
        <div
          key={card.title}
          className={`dashboard-card dashboard-card--${card.variant}`}
        >
          <span className="dashboard-card__title">{card.title}</span>
          <span className="dashboard-card__value">{card.value}</span>
        </div>
      ))}
    </div>
  )
}
