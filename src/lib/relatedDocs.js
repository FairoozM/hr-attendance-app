/**
 * relatedDocs.js
 * Utility for matching docs to an issue based on project/labels.
 * Used in IssueDetailPanel to show "Related Docs" chips.
 */

const STORAGE_KEY = 'lifesmile.linear.docs.v1'

export function loadDocsForIssue({ projectName, labels = [] } = {}) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const { docs } = JSON.parse(raw) || {}
    if (!Array.isArray(docs)) return []
    const pn = (projectName || '').toLowerCase()
    const lb = (labels || []).map(l => l.toLowerCase())
    return docs
      .filter(d => {
        if (pn) {
          const cats = {
            'Website': ['web', 'website', 'lifesmile'],
            'Android App': ['android'],
            'iOS App': ['ios'],
            'Backend/API': ['backend', 'api'],
            'UX/UI': ['ux', 'ui', 'design'],
            'Data & BI': ['bi', 'data'],
          }
          const matchCat = Object.entries(cats).some(([catKey, terms]) =>
            d.category === catKey && terms.some(t => pn.includes(t))
          )
          if (matchCat) return true
        }
        // Match by tag overlap
        if (lb.length > 0) {
          const tagHit = (d.tags || []).some(t => lb.includes(t.toLowerCase()))
          if (tagHit) return true
        }
        // QA always shows for all issues
        if (d.category === 'QA' || d.category === 'SOP') return true
        return false
      })
      .slice(0, 4)
  } catch {
    return []
  }
}
