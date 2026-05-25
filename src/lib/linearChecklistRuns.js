/**
 * linearChecklistRuns.js
 * Storage helpers for checklist run state (issue and release contexts).
 */

const ISSUE_KEY   = 'lifesmile.linear.issueChecklistRuns.v1'
const RELEASE_KEY = 'lifesmile.linear.releaseChecklistRuns.v1'

function storageKey(contextType) {
  return contextType === 'release' ? RELEASE_KEY : ISSUE_KEY
}

// ── Persistence ────────────────────────────────────────────────────────────

export function loadRuns(contextType) {
  try {
    const raw = localStorage.getItem(storageKey(contextType))
    if (!raw) return {}
    return JSON.parse(raw) || {}
  } catch { return {} }
}

function saveRuns(contextType, runs) {
  try { localStorage.setItem(storageKey(contextType), JSON.stringify(runs)) } catch {}
}

export function runId(contextId, docId) {
  return `${contextId}__${docId}`
}

export function loadRun(contextType, contextId, docId) {
  const runs = loadRuns(contextType)
  return runs[runId(contextId, docId)] || null
}

export function saveRun(contextType, run) {
  const runs = loadRuns(contextType)
  const id = runId(run.contextId, run.docId)
  runs[id] = { ...run, updatedAt: new Date().toISOString() }
  saveRuns(contextType, runs)
}

export function deleteRun(contextType, contextId, docId) {
  const runs = loadRuns(contextType)
  delete runs[runId(contextId, docId)]
  saveRuns(contextType, runs)
}

// ── Checklist extraction ───────────────────────────────────────────────────

/**
 * Extract checklist items from markdown-style doc content.
 * Priority: explicit [ ] checkboxes > bullet points > numbered lines.
 */
export function extractChecklistItems(content = '') {
  const lines = content.split('\n')
  const items = []

  for (const line of lines) {
    const t = line.trim()
    // - [ ] item  or  - [x] item  or  * [ ] item  or  1. [ ] item
    const m = t.match(/^(?:[-*]|\d+\.)\s+\[[ xX]\]\s+(.+)/)
    if (m) { items.push(m[1].trim()); continue }
    // bare  - [ ] item  (already handled above, but just in case)
    const m2 = t.match(/^\[[ xX]\]\s+(.+)/)
    if (m2) { items.push(m2[1].trim()); continue }
  }

  // Fallback: bullet lines
  if (items.length === 0) {
    for (const line of lines) {
      const t = line.trim()
      const m = t.match(/^[-*]\s+(.+)/)
      if (m) items.push(m[1].trim())
    }
  }

  // Fallback: numbered lines
  if (items.length === 0) {
    for (const line of lines) {
      const t = line.trim()
      const m = t.match(/^\d+\.\s+(.+)/)
      if (m) items.push(m[1].trim())
    }
  }

  return items
}

/**
 * Stable per-item key: docId + normalized first-80-chars of item text.
 * If item text changes, the key changes (treated as new item).
 */
export function itemKey(docId, itemText) {
  const norm = itemText.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)
  return `${docId}__${norm}`
}

// ── Run summary text ───────────────────────────────────────────────────────

export function buildRunResultText({ doc, contextLabel, items, completedItems, notes }) {
  const total     = items.length
  const doneKeys  = new Set(Object.keys(completedItems).filter(k => completedItems[k]))
  const done      = items.filter(it => doneKeys.has(itemKey(doc.id, it)))
  const pending   = items.filter(it => !doneKeys.has(itemKey(doc.id, it)))
  const now       = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const lines = [
    `# ${doc.title}`,
    `Context: ${contextLabel}`,
    `Progress: ${done.length}/${total} complete`,
    '',
    '## Completed',
    ...done.map(it => `- [x] ${it}`),
    '',
    '## Pending',
    ...pending.map(it => `- [ ] ${it}`),
  ]
  if (notes?.trim()) lines.push('', `## Notes`, notes.trim())
  lines.push('', `Generated: ${now}`)
  return lines.join('\n')
}
