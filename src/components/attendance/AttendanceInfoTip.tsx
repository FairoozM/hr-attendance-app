import { Info } from 'lucide-react'
import { type ReactNode, useId } from 'react'

/** Small (i) button that reveals an explanation on hover or keyboard focus. */
export function AttendanceInfoTip({
  label,
  align = 'center',
  children,
}: {
  label: string
  /** Which edge of the bubble lines up with the icon; use `end` near the right edge of the page. */
  align?: 'start' | 'center' | 'end'
  children: ReactNode
}) {
  const id = useId()
  return (
    <span className="att-tip">
      <button type="button" className="att-tip__trigger" aria-label={label} aria-describedby={id}>
        <Info size={13} aria-hidden />
      </button>
      <span role="tooltip" id={id} className={`att-tip__bubble att-tip__bubble--${align}`}>
        {children}
      </span>
    </span>
  )
}
