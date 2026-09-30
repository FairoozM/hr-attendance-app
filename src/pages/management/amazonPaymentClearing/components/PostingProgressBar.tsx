import { useEffect, useState } from 'react'
import type { PostingJobProgress } from '../../../../api/amazonPaymentClearing'

function elapsedText(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function PostingProgressBar({
  progress,
  startedAt,
}: {
  progress: PostingJobProgress | null
  startedAt: number | null
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const total = progress?.total || 0
  const done = Math.min(progress?.current || 0, total)
  const finishing = total > 0 && done >= total
  const donePct = total ? (done / total) * 100 : 0
  const activePct = total && !finishing ? 100 / total : 0
  const heading = !total
    ? 'Starting Zoho posting…'
    : finishing
      ? `All ${total} entries sent. Saving the result…`
      : `Entry ${done + 1} of ${total}: ${progress?.step || ''}`

  return (
    <div className="apc-progress" role="status" aria-live="polite">
      <div className="apc-progress__head">
        <strong>{heading}</strong>
        <span className="apc-progress__meta">
          {total ? `${done}/${total} done` : null} · {elapsedText(now - (startedAt || now))}
        </span>
      </div>
      <div
        className="apc-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total || 1}
        aria-valuenow={done}
      >
        <div className="apc-progress__fill" style={{ width: `${donePct}%` }} />
        {total ? (
          <div className="apc-progress__active" style={{ left: `${donePct}%`, width: `${activePct}%` }} />
        ) : (
          <div className="apc-progress__active apc-progress__active--indeterminate" />
        )}
      </div>
      <p className="apc-muted apc-progress__note">
        Each sales payment is applied to hundreds of invoices, so Zoho can take a minute or more per payment. Keep this
        tab open until it finishes.
      </p>
    </div>
  )
}
