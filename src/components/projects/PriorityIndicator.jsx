export function PriorityIndicator({ score, showLabel = true }) {
  const level = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low'
  const flames = score >= 75 ? 3 : score >= 50 ? 2 : score >= 25 ? 1 : 0

  return (
    <span className={`ai-priority ai-priority--${level}`} title={`Priority score: ${score}`}>
      {flames > 0 && <span className="ai-priority__flames" aria-hidden>{'🔥'.repeat(flames)}</span>}
      {showLabel && <span className="ai-priority__score">{score}</span>}
    </span>
  )
}

export function EnergyBadge({ energyType }) {
  if (!energyType) return null
  const isDeep = energyType === 'Deep Work'
  return (
    <span className={`ai-energy-badge${isDeep ? ' ai-energy-badge--deep' : ' ai-energy-badge--shallow'}`}>
      {isDeep ? '🧠 Deep' : '⚡ Shallow'}
    </span>
  )
}
