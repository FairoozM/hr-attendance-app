/**
 * linearChecklistCompliance.js
 * Derives SOP checklist compliance status for issues and releases.
 */
import { loadRuns, extractChecklistItems, itemKey } from './linearChecklistRuns'
import { getRelatedDocsForQA, getRelatedDocsForRelease } from './linearDocsMatcher'

// ── Status thresholds ──────────────────────────────────────────────────────

export function getComplianceStatus(percent) {
  if (percent === 100) return { label: 'Complete',    color: '#059669', level: 'complete' }
  if (percent >= 70)  return { label: 'Good',         color: '#0891b2', level: 'good'     }
  if (percent >= 1)   return { label: 'Needs Work',   color: '#f59e0b', level: 'needs_work' }
  return                      { label: 'Not Started', color: '#9ca3af', level: 'not_started' }
}

// ── Per-doc progress ───────────────────────────────────────────────────────

function calcDocProgress(doc, runs, contextType) {
  const items = extractChecklistItems(doc?.content || '')
  if (!items.length) return null         // doc has no checklist — skip

  const run = runs[`${contextType === 'release' ? 'rel' : ''}${doc.id}`] || findRun(runs, doc.id)
  const completedItems = run?.completedItems || {}
  const done = items.filter(it => completedItems[itemKey(doc.id, it)])

  const pct = items.length > 0 ? Math.round((done.length / items.length) * 100) : 0
  return {
    doc,
    items,
    done:   done.length,
    total:  items.length,
    pct,
    status: getComplianceStatus(pct),
    run,
  }
}

function findRun(runs, docId) {
  // Runs are keyed by `contextId__docId` — scan for any run with matching docId
  for (const key of Object.keys(runs)) {
    if (key.includes(`__${docId}`)) return runs[key]
  }
  return null
}

// ── Issue compliance ───────────────────────────────────────────────────────

/**
 * @param {object} issue
 * @param {object} project
 * @returns {{ progresses: object[], overallPct: number, status: object, hasChecklists: boolean }}
 */
export function getIssueChecklistCompliance(issue, project) {
  try {
    const docs = getRelatedDocsForQA(issue, project)
    if (!docs.length) return { progresses: [], overallPct: 0, status: getComplianceStatus(0), hasChecklists: false }

    const runs = loadRuns('issue')
    const progresses = docs.map(d => calcDocProgress(d, runs, 'issue')).filter(Boolean)

    if (!progresses.length) return { progresses: [], overallPct: 0, status: getComplianceStatus(0), hasChecklists: false }

    const totalItems = progresses.reduce((s, p) => s + p.total, 0)
    const doneItems  = progresses.reduce((s, p) => s + p.done,  0)
    const overallPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0

    return {
      progresses,
      overallPct,
      status:       getComplianceStatus(overallPct),
      hasChecklists: true,
    }
  } catch { return { progresses: [], overallPct: 0, status: getComplianceStatus(0), hasChecklists: false } }
}

// ── Release compliance ─────────────────────────────────────────────────────

/**
 * @param {string} selectionKey  sorted joined issue IDs (same as ChecklistRunner contextId)
 * @param {object[]} selectedIssues
 * @param {object} projectsMap
 * @returns {{ releasePct, releaseStatus, issueCompliances, warningNeeded }}
 */
export function getReleaseChecklistCompliance(selectionKey, selectedIssues, projectsMap) {
  try {
    const releaseRuns = loadRuns('release')
    const issueRuns   = loadRuns('issue')

    // Release-level checklist docs (same function used in Phase 13B/C)
    const releaseDocs = getRelatedDocsForRelease(selectedIssues, projectsMap)
    const releaseProgresses = releaseDocs
      .map(d => calcDocProgress(d, releaseRuns, 'release'))
      .filter(Boolean)

    const relTotalItems = releaseProgresses.reduce((s, p) => s + p.total, 0)
    const relDoneItems  = releaseProgresses.reduce((s, p) => s + p.done,  0)
    const releasePct    = relTotalItems > 0 ? Math.round((relDoneItems / relTotalItems) * 100) : 0
    const releaseStatus = getComplianceStatus(relTotalItems > 0 ? releasePct : 0)

    // Per-issue QA compliance
    const issueCompliances = selectedIssues.map(iss => {
      const project = projectsMap[iss.projectId]
      const docs = getRelatedDocsForQA(iss, project)
      const progresses = docs.map(d => calcDocProgress(d, issueRuns, 'issue')).filter(Boolean)
      const totalItems = progresses.reduce((s, p) => s + p.total, 0)
      const doneItems  = progresses.reduce((s, p) => s + p.done,  0)
      const pct        = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0
      return {
        issue,
        iss,
        pct,
        status:       getComplianceStatus(totalItems > 0 ? pct : 0),
        hasChecklists: progresses.length > 0,
        progresses,
      }
    })

    // Warning needed if release checklist < 70% or any issue checklist < 70%
    const releaseWarn = relTotalItems > 0 && releasePct < 70
    const issueWarn   = issueCompliances.some(ic => ic.hasChecklists && ic.pct < 70)
    const warningNeeded = releaseWarn || issueWarn

    return { releaseProgresses, releasePct, releaseStatus, issueCompliances, warningNeeded, relTotalItems }
  } catch {
    return { releaseProgresses: [], releasePct: 0, releaseStatus: getComplianceStatus(0), issueCompliances: [], warningNeeded: false, relTotalItems: 0 }
  }
}

// ── SOP summary for copy helpers ────────────────────────────────────────────

export function buildSopSummaryText(compliance) {
  if (!compliance) return ''
  const { progresses, overallPct, status, hasChecklists } = compliance
  if (!hasChecklists) return ''
  const lines = [
    `## SOP Checklist Compliance: ${status.label} (${overallPct}%)`,
  ]
  for (const p of progresses) {
    const mark = p.pct === 100 ? '✓' : p.pct >= 70 ? '~' : '⚠'
    lines.push(`  ${mark} ${p.doc.title}: ${p.done}/${p.total} (${p.pct}%)`)
  }
  return lines.join('\n')
}

export function buildReleaseSopSummaryText(compliance) {
  if (!compliance) return ''
  const { releaseProgresses, releasePct, releaseStatus, issueCompliances, relTotalItems } = compliance
  const lines = []

  if (relTotalItems > 0) {
    lines.push(`## Release SOP Compliance: ${releaseStatus.label} (${releasePct}%)`)
    for (const p of releaseProgresses) {
      const mark = p.pct === 100 ? '✓' : p.pct >= 70 ? '~' : '⚠'
      lines.push(`  ${mark} ${p.doc.title}: ${p.done}/${p.total} (${p.pct}%)`)
    }
    lines.push('')
  }

  const issuesBelowGood = issueCompliances.filter(ic => ic.hasChecklists && ic.pct < 70)
  if (issuesBelowGood.length > 0) {
    lines.push(`## Issues with Incomplete SOP Checklists`)
    for (const ic of issuesBelowGood) {
      lines.push(`  ⚠ Issue #${ic.iss.id}: ${ic.iss.title} — ${ic.pct}%`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ── Helper for Inbox ────────────────────────────────────────────────────────

/** Returns true if issue has checklist docs and overall compliance < 70% */
export function issueNeedsSop(issue, project) {
  try {
    const c = getIssueChecklistCompliance(issue, project)
    return c.hasChecklists && c.overallPct < 70
  } catch { return false }
}
