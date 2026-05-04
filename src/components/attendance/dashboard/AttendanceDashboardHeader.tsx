type Props = {
  contextLabel: string
  totalEmployees: number
}

export function AttendanceDashboardHeader({ contextLabel, totalEmployees }: Props) {
  return (
    <header className="adash__header">
      <h2 className="adash__title">Attendance overview</h2>
      <p className="adash__subtitle">
        <strong>{totalEmployees}</strong> {totalEmployees === 1 ? 'employee' : 'employees'} in view ·
        Snapshot <strong>{contextLabel}</strong>. Filters below apply only to this dashboard.
      </p>
    </header>
  )
}
