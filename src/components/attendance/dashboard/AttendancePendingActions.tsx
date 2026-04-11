import type { AttendancePendingActionItem } from '../../../types/attendance'

type Props = {
  items: AttendancePendingActionItem[]
  leaveLoading?: boolean
}

export function AttendancePendingActions({ items, leaveLoading }: Props) {
  return (
    <div className="adash-panel">
      <h3 className="adash-panel__title">Pending actions</h3>
      {leaveLoading && <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>Loading leave data…</p>}
      {!leaveLoading && items.length === 0 && (
        <p className="adash-empty" style={{ padding: '0.5rem 0' }}>
          No pending approvals.
        </p>
      )}
      {!leaveLoading &&
        items.map((p) => (
          <div key={p.id} className="adash-alert adash-alert--info">
            <div>
              <strong>{p.label}</strong>
              {p.meta && <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{p.meta}</div>}
            </div>
          </div>
        ))}
    </div>
  )
}
