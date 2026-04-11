type Props = {
  message?: string
}

export function AttendanceEmptyState({ message = 'No employees in scope for this dashboard.' }: Props) {
  return (
    <div className="adash-panel">
      <p className="adash-empty">{message}</p>
    </div>
  )
}
