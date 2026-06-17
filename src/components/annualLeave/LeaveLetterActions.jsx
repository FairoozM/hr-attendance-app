export function LeaveLetterActions({ row, isAdmin, letterBusy, onPreview, onDownload, onRegenerate }) {
  const busy = letterBusy
  return (
    <div className="al-doc-actions" onClick={(e) => e.stopPropagation()}>
      <span className="al-doc-actions__title">Formal leave letter</span>
      <div className="al-doc-actions__btns">
        <button
          type="button"
          className="al-btn al-btn--ghost al-btn--sm"
          disabled={busy}
          onClick={() => onPreview(row.id)}
        >
          Preview
        </button>
        <button
          type="button"
          className="al-btn al-btn--ghost al-btn--sm"
          disabled={busy}
          onClick={() => onDownload(row.id)}
        >
          Download PDF
        </button>
        {isAdmin && (
          <button
            type="button"
            className="al-btn al-btn--ghost al-btn--sm"
            disabled={busy}
            onClick={() => onRegenerate(row.id)}
          >
            {busy ? 'Working…' : 'Regenerate'}
          </button>
        )}
      </div>
    </div>
  )
}
