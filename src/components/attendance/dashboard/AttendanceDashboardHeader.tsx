type Props = {
  contextLabel: string
}

export function AttendanceDashboardHeader({ contextLabel }: Props) {
  return (
    <header className="adash__header">
      <h2 className="adash__title">Attendance dashboard</h2>
      <p className="adash__subtitle">
        Snapshot for <strong>{contextLabel}</strong> — filters below apply only to this dashboard.
      </p>
    </header>
  )
}
