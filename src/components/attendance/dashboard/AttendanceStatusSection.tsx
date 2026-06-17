import { EmployeeAvatar } from '../../employees/EmployeeAvatar'
import { colorForStatus } from '../../../utils/attendance/attendanceStatusColors'
import type { AttendanceStatusItem } from '../../../types/attendance'

type Props = {
  title: string
  items: AttendanceStatusItem[]
  emptyText?: string
}

export function AttendanceStatusSection({ title, items, emptyText = 'No one' }: Props) {
  return (
    <div className="adash-panel">
      <div className="adash-status-block__head">
        <span>{title}</span>
        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="adash-empty" style={{ padding: '0.5rem 0' }}>
          {emptyText}
        </p>
      ) : (
        <div>
          {items.map((row) => {
            const col = colorForStatus(row.status)
            return (
              <div key={row.employee.id + row.status} className="adash-status-row">
                <EmployeeAvatar name={row.employee.name} photoUrl={row.employee.photoUrl} size="sm" />
                <div className="adash-status-row__meta">
                  <span className="adash-status-row__name" title={row.employee.name}>
                    {row.employee.name}
                  </span>
                  <span className="adash-status-row__dept" title={row.employee.department || undefined}>
                    {row.employee.department || '—'}
                  </span>
                </div>
                <span
                  className="adash-badge adash-status-row__badge"
                  style={{
                    background: col.bg,
                    color: col.text,
                    border: `1px solid ${col.border}`,
                  }}
                >
                  {row.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
