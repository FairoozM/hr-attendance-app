import { CATEGORY_META } from '../../lib/aiEngine'

export function CategoryBadge({ category, size = 'sm' }) {
  if (!category) return null
  const meta = CATEGORY_META[category] || CATEGORY_META.Admin
  return (
    <span
      className={`ai-category-badge ai-category-badge--${size}`}
      style={{ '--cat-color': meta.color, '--cat-bg': meta.bg }}
    >
      <span aria-hidden>{meta.icon}</span>
      {category}
    </span>
  )
}
