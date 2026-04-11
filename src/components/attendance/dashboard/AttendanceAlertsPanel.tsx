import type { AttendanceAlertItem } from '../../../types/attendance'

type Props = {
  alerts: AttendanceAlertItem[]
}

export function AttendanceAlertsPanel({ alerts }: Props) {
  if (!alerts.length) {
    return (
      <div className="adash-panel">
        <h3 className="adash-panel__title">Alerts</h3>
        <p className="adash-empty" style={{ padding: '1rem 0' }}>
          No alerts for current filters.
        </p>
      </div>
    )
  }

  return (
    <div className="adash-panel">
      <h3 className="adash-panel__title">Alerts</h3>
      {alerts.map((a) => (
        <div
          key={a.id}
          className={`adash-alert adash-alert--${a.severity === 'danger' ? 'danger' : a.severity === 'warning' ? 'warning' : 'info'}`}
        >
          <div>
            <strong>{a.title}</strong>
            {a.detail && <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{a.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
