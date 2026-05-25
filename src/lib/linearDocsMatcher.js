/**
 * linearDocsMatcher.js
 * Smart matching logic for surfacing relevant docs in issues, releases, dev, and QA workflows.
 * Pure functions — no side effects.
 */

const STORAGE_KEY = 'lifesmile.linear.docs.v1'

// ── Load from localStorage ─────────────────────────────────────────────────

export function loadAllDocs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const { docs } = JSON.parse(raw) || {}
    return Array.isArray(docs) ? docs : []
  } catch { return [] }
}

// ── Category → project keyword mapping ────────────────────────────────────

const CAT_TERMS = {
  'Website':      ['web', 'website', 'lifesmile', 'frontend', 'ecommerce'],
  'Android App':  ['android'],
  'iOS App':      ['ios'],
  'Backend/API':  ['backend', 'api', 'server', 'database'],
  'UX/UI':        ['ux', 'ui', 'design', 'figma'],
  'Data & BI':    ['bi', 'data', 'analytics'],
  'Releases':     ['release'],
  'QA':           ['qa', 'quality', 'test'],
  'SOP':          ['sop', 'workflow', 'process'],
}

// ── Score a single doc against issue context ───────────────────────────────

function scoreDocForIssue(doc, { projectName = '', labels = [], status = '', title = '', devMeta = {} }) {
  let score = 0
  const pn     = projectName.toLowerCase()
  const dtags  = (doc.tags || []).map(t => t.toLowerCase())
  const dtitle = doc.title.toLowerCase()
  const lb     = labels.map(l => l.toLowerCase())
  const tl     = title.toLowerCase()
  const st     = status.toLowerCase()

  // Project name ↔ category terms
  const terms = CAT_TERMS[doc.category] || []
  if (terms.some(t => pn.includes(t))) score += 3

  // Label overlap with doc tags
  const labelHits = lb.filter(l => dtags.some(t => l.includes(t) || t.includes(l)))
  score += labelHits.length * 2

  // Issue title keyword → doc tag match
  const titleKws = ['checkout', 'smoke', 'android', 'ios', 'backend', 'deploy', 'github', 'pr', 'release', 'qa', 'cloudfront']
  for (const kw of titleKws) {
    if (tl.includes(kw) && (dtags.includes(kw) || dtitle.includes(kw))) score += 2
  }

  // Status-based boosts
  if ((st.includes('ready') || st.includes('release')) &&
      (dtitle.includes('release') || doc.category === 'Releases')) score += 3
  if ((st.includes('review') || st.includes('qa')) && doc.category === 'QA') score += 2

  // devMeta: has PR → GitHub Workflow doc
  if ((devMeta?.prUrl || devMeta?.prTitle) && (dtitle.includes('github') || dtitle.includes('pr workflow'))) score += 4

  // SOP / QA get small baseline so they're always somewhat present
  if (doc.category === 'SOP') score += 1
  if (doc.category === 'QA')  score += 1

  return score
}

// ── Public matchers ───────────────────────────────────────────────────────

/**
 * Best-matching docs for an issue (general — used in Details tab).
 */
export function getRelatedDocsForIssue(issue, project, docs = null) {
  const all = docs || loadAllDocs()
  const opts = {
    projectName: project?.name || '',
    labels:      issue?.labels || [],
    status:      issue?.status || '',
    title:       issue?.title || '',
    devMeta:     issue?.devMeta || {},
  }
  return all
    .map(d => ({ d, s: scoreDocForIssue(d, opts) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.d)
    .slice(0, 5)
}

/**
 * Dev-workflow docs (for the Dev tab: GitHub, deployment, platform-specific).
 */
export function getRelatedDocsForDev(issue, project, docs = null) {
  const all = docs || loadAllDocs()
  const pn  = (project?.name || '').toLowerCase()
  const has = (kw) => (issue?.devMeta?.prUrl || issue?.devMeta?.prTitle || issue?.devMeta?.repo) && kw

  return all.filter(d => {
    const dt = d.title.toLowerCase()
    // GitHub PR Workflow — show whenever there's dev activity or always
    if (dt.includes('github') || dt.includes('pr workflow')) return true
    // Backend Deployment Checklist
    if (dt.includes('backend') && pn.includes('backend')) return true
    // CloudFront / CDN
    if ((dt.includes('cloudfront') || dt.includes('cdn')) && (pn.includes('web') || pn.includes('website'))) return true
    // Android/iOS release checklists
    if (dt.includes('android release') && pn.includes('android')) return true
    if (dt.includes('ios release') && pn.includes('ios')) return true
    return false
  }).slice(0, 4)
}

/**
 * QA-relevant docs (for the QA tab: QA checklists, smoke tests).
 */
export function getRelatedDocsForQA(issue, project, docs = null) {
  const all = docs || loadAllDocs()
  const pn  = (project?.name || '').toLowerCase()
  const lb  = (issue?.labels || []).map(l => l.toLowerCase())
  const tl  = (issue?.title || '').toLowerCase()

  return all.filter(d => {
    const dt = d.title.toLowerCase()
    if (d.category === 'QA') return true
    if (dt.includes('smoke') && (lb.some(l => l.includes('checkout')) || tl.includes('checkout'))) return true
    return false
  }).slice(0, 5)
}

/**
 * Docs relevant to a set of selected issues on the Releases page.
 */
export function getRelatedDocsForRelease(selectedIssues = [], projectsMap = {}, docs = null) {
  const all = docs || loadAllDocs()

  // Collect distinct project names
  const projNames = [...new Set(
    selectedIssues.map(i => (projectsMap[i.projectId]?.name || '').toLowerCase())
  )]

  // Per-doc best score across all selected project names
  const scoreMap = new Map()
  for (const pn of projNames) {
    for (const d of all) {
      const s = scoreDocForIssue(d, { projectName: pn, labels: [], status: 'ready for release', title: '' })
      scoreMap.set(d.id, Math.max(scoreMap.get(d.id) || 0, s))
    }
  }

  // Critical release docs always appear
  const CRITICAL = new Set([
    'Release Approval Workflow',
    'Checkout Smoke Test',
    'Website QA Checklist',
  ])

  return all
    .map(d => ({ d, s: (scoreMap.get(d.id) || 0) + (CRITICAL.has(d.title) ? 6 : 0) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.d)
    .slice(0, 7)
}

// ── Workflow hints map (static — matched by doc title) ─────────────────────

const WORKFLOW_HINTS_BY_TITLE = {
  'Website QA Checklist':           ['Issues', 'QA tab', 'Releases'],
  'Checkout Smoke Test':            ['QA tab', 'Releases'],
  'Product Page QA Checklist':      ['Issues', 'QA tab'],
  'Android Release Checklist':      ['Issues', 'Dev tab', 'Releases'],
  'iOS Release Checklist':          ['Issues', 'Dev tab', 'Releases'],
  'Backend Deployment Checklist':   ['Dev tab', 'Releases'],
  'CloudFront / CDN Deployment Notes': ['Dev tab', 'Releases'],
  'GitHub PR Workflow':             ['Dev tab'],
  'Intake to Issue Workflow':       ['Issues'],
  'Release Approval Workflow':      ['Releases'],
}

/**
 * Returns workflow hint labels for a doc title, if any.
 * @param {string} title
 * @returns {string[]}
 */
export function getWorkflowHints(title) {
  return WORKFLOW_HINTS_BY_TITLE[title] || []
}
