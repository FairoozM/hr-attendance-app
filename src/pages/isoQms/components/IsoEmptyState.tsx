interface IsoEmptyStateProps {
  title?: string
  message?: string
}

export function IsoEmptyState({
  title = 'No records yet',
  message = 'Nothing to show. Upload evidence or adjust filters.',
}: IsoEmptyStateProps) {
  return (
    <div className="iso-empty" role="status">
      <strong>{title}</strong>
      <div>{message}</div>
    </div>
  )
}

interface IsoLoadingStateProps {
  message?: string
}

export function IsoLoadingState({ message = 'Loading…' }: IsoLoadingStateProps) {
  return (
    <div className="iso-loading" role="status" aria-live="polite">
      {message}
    </div>
  )
}
