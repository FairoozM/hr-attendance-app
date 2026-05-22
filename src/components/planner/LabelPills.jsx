/**
 * LabelPills.jsx
 * Renders a task's labels array as compact coloured pill chips.
 */

const LABEL_COLORS = [
  '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9',
  '#10b981', '#f59e0b', '#f97316', '#ef4444',
  '#ec4899', '#06b6d4', '#84cc16', '#a855f7',
]

function labelColor(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff
  return LABEL_COLORS[Math.abs(h) % LABEL_COLORS.length]
}

export function LabelPills({ labels = [], max = 3 }) {
  if (!Array.isArray(labels) || labels.length === 0) return null

  const visible  = labels.slice(0, max)
  const overflow = labels.length - max

  return (
    <span className="lp-wrap">
      {visible.map((lbl) => {
        const color = labelColor(lbl)
        return (
          <span
            key={lbl}
            className="lp-pill"
            style={{ '--lp-color': color }}
            title={lbl}
          >
            {lbl}
          </span>
        )
      })}
      {overflow > 0 && (
        <span className="lp-pill lp-pill--overflow">+{overflow}</span>
      )}
    </span>
  )
}

export default LabelPills
