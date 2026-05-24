/**
 * linearLabels.js
 * Canonical list of predefined labels for Life Smile product/dev issues.
 * Used in LabelPicker, IssueRow pills, and label filters.
 *
 * UI says "Issue" and "Cycle", not Task/Sprint. No Jira wording.
 * backend stores labels as TEXT[] in project_tasks.labels — no migration needed.
 */

export const DEFAULT_LABELS = [
  'Checkout',
  'Product Page',
  'Homepage',
  'Search',
  'Payment',
  'Performance',
  'Mobile UX',
  'Arabic',
  'SEO',
  'Amazon Sync',
  'Zoho Sync',
  'Release Blocker',
  'Bug',
  'UX Review',
  'App Store',
  'Play Store',
]

/**
 * Simple deterministic color from a label string.
 * Returns a hue value (0–359) — CSS HSL hue.
 */
function labelHue(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff
  return Math.abs(h) % 360
}

/** Returns { bg, border, text } CSS color strings for a label. */
export function labelColors(label) {
  const hue = labelHue(label)
  return {
    bg:     `hsla(${hue}, 65%, 55%, 0.15)`,
    border: `hsla(${hue}, 65%, 60%, 0.35)`,
    text:   `hsl(${hue}, 70%, 68%)`,
  }
}

/** Normalise a raw labels value from the server to a clean string[]. */
export function normalizeLabels(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean)
    } catch {
      // not JSON — split by comma
      return raw.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}
