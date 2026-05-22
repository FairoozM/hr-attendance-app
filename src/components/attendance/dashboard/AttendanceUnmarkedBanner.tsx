type Props = {
  count: number
  snapshotLabel: string
}

export function AttendanceUnmarkedBanner({ count, snapshotLabel }: Props) {
  if (count <= 0) return null

  const handleJumpClick = () => {
    document.getElementById('attendance-detail-grid')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  return (
    <div className="adash-banner adash-banner--warning" role="status">
      <div className="adash-banner__body">
        <span className="adash-banner__title">Action required</span>
        <span className="adash-banner__text">
          {count === 1
            ? `1 employee has no attendance status on ${snapshotLabel}.`
            : `${count} employees have no attendance status on ${snapshotLabel}.`}
        </span>
      </div>
      <button type="button" className="adash-banner__link" onClick={handleJumpClick}>
        Jump to grid
      </button>
    </div>
  )
}
