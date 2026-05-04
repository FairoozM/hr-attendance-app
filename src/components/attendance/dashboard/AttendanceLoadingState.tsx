export function AttendanceLoadingState() {
  return (
    <div className="adash" aria-busy="true" aria-label="Loading dashboard">
      <div className="adash-skeleton adash-skeleton--shell" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="adash-skeleton" style={{ height: '88px' }} />
        ))}
      </div>
      <div className="adash-skeleton" style={{ height: '200px', width: '100%' }} />
    </div>
  )
}
