/**
 * IssueDevWorkflow — "Dev" tab inside IssueDetailPanel.
 *
 * Features:
 *   1. Auto-generated branch name slug + Copy Branch Name
 *   2. GitHub metadata form (branchName, prUrl, prStatus, commitRef)
 *      → Save persists via existing patch API (dev_meta JSONB)
 *   3. Copy Cursor Prompt  — inline generation, no AI call
 *   4. Copy QA Checklist   — adapted by project/type
 *   5. Copy Release Note   — short internal note
 *
 * Safety: Nothing auto-saves. User must click Save.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  GitBranch, Link2, GitCommit, GitPullRequest,
  Copy, Check, Save, Trash2, ChevronDown, ChevronRight,
} from 'lucide-react'
import { issueKey } from './IssueRow'
import './IssueDevWorkflow.css'

// ── Branch slug generation ─────────────────────────────────────────────────

function slugify(text = '') {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')    // strip special chars (keep word chars, spaces, hyphens)
    .replace(/[\s_]+/g, '-')     // spaces/underscores → hyphens
    .replace(/-+/g, '-')         // collapse multiple hyphens
    .replace(/^-+|-+$/g, '')     // trim leading/trailing hyphens
    .slice(0, 55)                // reasonable max length
}

export function generateBranchName(projectName, issueId, title = '') {
  const key = issueKey(projectName, issueId).toLowerCase()  // e.g. web-12
  const titleSlug = slugify(title)
  if (!titleSlug) return key
  return `${key}-${titleSlug}`
}

// ── PR status options ──────────────────────────────────────────────────────

const PR_STATUSES = [
  { value: '',            label: '— Not started' },
  { value: 'draft',       label: 'Draft' },
  { value: 'open',        label: 'Open' },
  { value: 'in_review',   label: 'In Review' },
  { value: 'merged',      label: 'Merged' },
  { value: 'closed',      label: 'Closed' },
]

// ── Copy helpers ───────────────────────────────────────────────────────────

/**
 * Builds a Cursor-ready implementation prompt from issue fields (no AI call).
 */
function buildCursorPrompt({ issue, project, devMeta }) {
  const key   = issueKey(project?.name, issue.id)
  const type  = issue.issueType || 'feature'
  const prio  = issue.priority  || 'Medium'
  const stat  = issue.status    || 'Todo'
  const lbl   = Array.isArray(issue.labels) && issue.labels.length ? issue.labels.join(', ') : 'none'
  const branch= devMeta?.branchName || generateBranchName(project?.name, issue.id, issue.title)
  const prUrl = devMeta?.prUrl || ''
  const desc  = issue.description?.trim() || '(no description provided)'

  return `# Cursor Implementation Prompt — ${key}

## Issue
**Key**: ${key}
**Title**: ${issue.title}
**Type**: ${type}
**Priority**: ${prio}
**Status**: ${stat}
**Project / Team**: ${project?.name || '(unknown)'}
**Labels**: ${lbl}${prUrl ? `\n**PR**: ${prUrl}` : ''}
**Branch**: \`${branch}\`

## Description
${desc}

## Goal
Implement the changes described above for the **${project?.name || 'Life Smile'}** team.

## Context
This is for Life Smile product/development collaboration across:
- lifesmile.ae (website)
- Android app
- iOS app
- Backend / API
- UX/UI Design
- Data & BI

## Implementation Requirements
1. Read the description and acceptance criteria above carefully before writing any code.
2. Only change files directly related to this issue.
3. Do not refactor unrelated modules.
4. Keep existing routes and API contracts working.
5. Do not add a DB migration unless the issue description explicitly requires one.
6. Prefer small, focused commits that map to a single logical change.

## Safety Rules
- Do not rename or delete existing exports used elsewhere.
- Do not change unrelated tests.
- Do not auto-format files outside the scope of this issue.
- Do not push API keys or secrets.
- Run \`npm run build\` (or equivalent) and confirm no new errors before finishing.

## Testing Checklist
- [ ] Feature/fix works as described
- [ ] No console errors introduced
- [ ] No TypeScript / lint errors introduced
- [ ] Existing tests still pass (run test suite if available)
- [ ] Tested on relevant platforms (see QA checklist)
- [ ] PR description explains what changed and why

## When Done
1. Open a PR against the main branch.
2. Link this issue in the PR description.
3. Tag a reviewer.
`.trim()
}

/**
 * Builds a QA checklist adapted to project + issue type.
 */
function buildQaChecklist({ issue, project }) {
  const proj = (project?.name || '').toLowerCase()
  const type = (issue.issueType || '').toLowerCase()
  const lbl  = (issue.labels || []).map((l) => l.toLowerCase()).join(' ')

  const lines = [
    `## QA Checklist — ${issueKey(project?.name, issue.id)}: ${issue.title}`,
    '',
    '### General',
    '- [ ] Feature works as described in the issue',
    '- [ ] No JavaScript console errors',
    '- [ ] No build / lint errors',
    '- [ ] Edge cases handled (empty state, loading, error state)',
    '',
  ]

  // Website / Frontend
  if (proj.includes('web') || proj.includes('website') || proj.includes('www') || proj.includes('ux') || proj.includes('ui')) {
    lines.push('### Website / Frontend')
    lines.push('- [ ] Tested on desktop (Chrome, Firefox or Safari)')
    lines.push('- [ ] Tested on mobile viewport (320px and 375px)')
    lines.push('- [ ] Tested logged-in and logged-out state')
    lines.push('- [ ] No layout / spacing regressions on existing pages')
    if (lbl.includes('checkout') || lbl.includes('cart'))   lines.push('- [ ] Checkout flow works end-to-end')
    if (lbl.includes('search'))                              lines.push('- [ ] Search returns correct results')
    if (lbl.includes('product') || lbl.includes('catalog')) lines.push('- [ ] Product listing and detail pages load correctly')
    lines.push('')
  }

  // Android
  if (proj.includes('android') || proj.includes(' and')) {
    lines.push('### Android')
    lines.push('- [ ] App installs and opens without crash')
    lines.push('- [ ] Feature works on Android 10+ (minimum supported version)')
    lines.push('- [ ] Navigation stack is correct (back button works)')
    lines.push('- [ ] Dark mode renders correctly')
    if (lbl.includes('checkout') || lbl.includes('cart')) lines.push('- [ ] Checkout flow works on Android')
    if (lbl.includes('push') || lbl.includes('notification')) lines.push('- [ ] Push notifications received correctly')
    if (lbl.includes('deep link'))                            lines.push('- [ ] Deep links open correct screen')
    lines.push('')
  }

  // iOS
  if (proj.includes('ios') || proj.includes('iphone') || proj.includes('apple')) {
    lines.push('### iOS')
    lines.push('- [ ] App installs and opens without crash on iOS 15+')
    lines.push('- [ ] Feature works on iPhone 12 and iPhone SE viewport')
    lines.push('- [ ] Navigation stack is correct')
    lines.push('- [ ] Dark mode renders correctly')
    if (lbl.includes('checkout') || lbl.includes('cart')) lines.push('- [ ] Checkout flow works on iOS')
    if (lbl.includes('push') || lbl.includes('notification')) lines.push('- [ ] Push notifications received correctly')
    lines.push('')
  }

  // Backend / API
  if (proj.includes('backend') || proj.includes('api') || proj.includes('server')) {
    lines.push('### Backend / API')
    lines.push('- [ ] API returns correct response shape and status codes')
    lines.push('- [ ] Auth / permission checks enforced (unauthorized returns 401/403)')
    lines.push('- [ ] Input validation rejects bad data gracefully (400)')
    lines.push('- [ ] Error cases return JSON, not HTML')
    lines.push('- [ ] No N+1 queries introduced')
    lines.push('- [ ] Migration (if any) is idempotent and reversible')
    lines.push('- [ ] Logs are clean — no new uncaught exceptions')
    lines.push('')
  }

  // UX/UI
  if (type === 'ux/ui' || proj.includes('design')) {
    lines.push('### UX / UI')
    lines.push('- [ ] Design matches Figma / spec')
    lines.push('- [ ] Responsive at 320px, 768px, 1280px, 1920px')
    lines.push('- [ ] Typography, spacing, and colors match design system')
    lines.push('- [ ] Empty state is handled')
    lines.push('- [ ] Loading state is handled')
    lines.push('- [ ] Error state is handled')
    lines.push('- [ ] Accessible — keyboard nav and screen reader basics work')
    lines.push('')
  }

  // BI / Data
  if (proj.includes('data') || proj.includes(' bi') || proj === 'bi' || proj.includes('analytics')) {
    lines.push('### Data & BI')
    lines.push('- [ ] Filters apply correctly and update results')
    lines.push('- [ ] Totals and aggregations match expected values')
    lines.push('- [ ] Date range filter works correctly')
    lines.push('- [ ] Export (CSV / Excel) includes all filtered rows')
    lines.push('- [ ] Dashboard loads without error on large data sets')
    lines.push('')
  }

  return lines.join('\n').trim()
}

/**
 * Builds a short release note.
 */
function buildReleaseNote({ issue, project }) {
  const key   = issueKey(project?.name, issue.id)
  const type  = issue.issueType || 'change'
  const prio  = issue.priority  || 'Medium'
  const desc  = issue.description?.trim() || ''
  const first = desc.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.slice(0, 120) || ''

  return `## Release Note — ${key}

**${issue.title}**

**Type**: ${type} | **Priority**: ${prio} | **Team**: ${project?.name || 'Life Smile'}

${first ? `${first}\n\n` : ''}**Impact**: Affects users of ${project?.name || 'the product'}.

**Testing**: Verify the change in ${project?.name || 'the app'} and confirm no regressions in adjacent features.
`.trim()
}

// ── Component ──────────────────────────────────────────────────────────────

export function IssueDevWorkflow({ issue, project, cycles = [], onSaveDevMeta }) {
  const suggestedBranch = generateBranchName(project?.name, issue?.id, issue?.title)

  // Local form state (initialized from issue.devMeta if present)
  const [form, setForm] = useState({
    branchName: '',
    prUrl:      '',
    prStatus:   '',
    commitRef:  '',
  })
  const [dirty, setDirty]   = useState(false)
  const [saving, setSaving] = useState(false)

  // Copy feedback state per button id
  const [copied, setCopied] = useState({})

  // Collapsible sections
  const [cursorOpen,  setCursorOpen]  = useState(false)
  const [qaOpen,      setQaOpen]      = useState(false)
  const [noteOpen,    setNoteOpen]    = useState(false)

  // Sync form when issue changes
  useEffect(() => {
    if (!issue) return
    const meta = issue.devMeta || {}
    setForm({
      branchName: meta.branchName || '',
      prUrl:      meta.prUrl      || '',
      prStatus:   meta.prStatus   || '',
      commitRef:  meta.commitRef  || '',
    })
    setDirty(false)
  }, [issue?.id, issue?.updatedAt])

  const setField = useCallback((key, val) => {
    setForm((prev) => ({ ...prev, [key]: val }))
    setDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    if (!onSaveDevMeta) return
    setSaving(true)
    try {
      await onSaveDevMeta(form)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [form, onSaveDevMeta])

  const handleClear = useCallback(async () => {
    const empty = { branchName: '', prUrl: '', prStatus: '', commitRef: '' }
    setForm(empty)
    setDirty(false)
    if (onSaveDevMeta) {
      setSaving(true)
      try { await onSaveDevMeta(empty) } finally { setSaving(false) }
    }
  }, [onSaveDevMeta])

  const copyText = useCallback((id, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied((prev) => ({ ...prev, [id]: true }))
      setTimeout(() => setCopied((prev) => ({ ...prev, [id]: false })), 2000)
    })
  }, [])

  const useBranchName = useCallback(() => {
    setField('branchName', suggestedBranch)
  }, [suggestedBranch, setField])

  if (!issue) return null

  const displayBranch = form.branchName || suggestedBranch
  const cursorPrompt  = buildCursorPrompt({ issue, project, devMeta: form })
  const qaChecklist   = buildQaChecklist({ issue, project })
  const releaseNote   = buildReleaseNote({ issue, project })

  return (
    <div className="idw">
      {/* ── Branch helper ─────────────────────────────────────────────── */}
      <section className="idw__section">
        <h3 className="idw__section-title">
          <GitBranch size={13} aria-hidden="true" />
          Branch
        </h3>

        <div className="idw__branch-suggestion">
          <code className="idw__branch-slug">{suggestedBranch}</code>
          <div className="idw__branch-actions">
            <button
              type="button"
              className="idw__copy-btn"
              onClick={() => copyText('branch', suggestedBranch)}
              title="Copy generated branch name"
            >
              {copied.branch ? <><Check size={12} />Copied</> : <><Copy size={12} />Copy</>}
            </button>
            <button
              type="button"
              className="idw__use-btn"
              onClick={useBranchName}
              title="Use as branch name below"
            >
              Use
            </button>
          </div>
        </div>
      </section>

      {/* ── GitHub metadata form ────────────────────────────────────────── */}
      <section className="idw__section">
        <h3 className="idw__section-title">
          <GitPullRequest size={13} aria-hidden="true" />
          GitHub Metadata
        </h3>

        <div className="idw__fields">
          <label className="idw__field">
            <GitBranch size={12} aria-hidden="true" />
            <span className="idw__field-label">Branch name</span>
            <input
              type="text"
              className="idw__input"
              value={form.branchName}
              onChange={(e) => setField('branchName', e.target.value)}
              placeholder={suggestedBranch}
            />
          </label>

          <label className="idw__field">
            <Link2 size={12} aria-hidden="true" />
            <span className="idw__field-label">PR URL</span>
            <input
              type="url"
              className="idw__input"
              value={form.prUrl}
              onChange={(e) => setField('prUrl', e.target.value)}
              placeholder="https://github.com/org/repo/pull/42"
            />
          </label>

          <label className="idw__field">
            <GitPullRequest size={12} aria-hidden="true" />
            <span className="idw__field-label">PR Status</span>
            <select
              className="idw__input idw__select"
              value={form.prStatus}
              onChange={(e) => setField('prStatus', e.target.value)}
            >
              {PR_STATUSES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="idw__field">
            <GitCommit size={12} aria-hidden="true" />
            <span className="idw__field-label">Commit ref</span>
            <input
              type="text"
              className="idw__input"
              value={form.commitRef}
              onChange={(e) => setField('commitRef', e.target.value)}
              placeholder="a1b2c3d"
            />
          </label>
        </div>

        <div className="idw__form-actions">
          <button
            type="button"
            className={`idw__save-btn ${dirty ? 'idw__save-btn--dirty' : ''}`}
            onClick={handleSave}
            disabled={saving}
          >
            <Save size={13} aria-hidden="true" />
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="idw__clear-btn"
            onClick={handleClear}
            disabled={saving}
            title="Clear all GitHub metadata"
          >
            <Trash2 size={12} aria-hidden="true" />
            Clear
          </button>
          {!dirty && !saving && (
            <span className="idw__saved-hint">Saved</span>
          )}
        </div>
      </section>

      {/* ── Copy helpers ─────────────────────────────────────────────── */}
      <section className="idw__section">
        <h3 className="idw__section-title">Copy Helpers</h3>

        {/* Cursor Prompt */}
        <div className="idw__copy-block">
          <div className="idw__copy-block-header">
            <button
              type="button"
              className="idw__copy-block-toggle"
              onClick={() => setCursorOpen((v) => !v)}
            >
              {cursorOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <strong>Cursor Prompt</strong>
              <span className="idw__copy-block-hint">Full implementation prompt for Cursor AI</span>
            </button>
            <button
              type="button"
              className="idw__copy-btn"
              onClick={() => copyText('cursor', cursorPrompt)}
            >
              {copied.cursor ? <><Check size={12} />Copied</> : <><Copy size={12} />Copy</>}
            </button>
          </div>
          {cursorOpen && <pre className="idw__preview">{cursorPrompt}</pre>}
        </div>

        {/* QA Checklist */}
        <div className="idw__copy-block">
          <div className="idw__copy-block-header">
            <button
              type="button"
              className="idw__copy-block-toggle"
              onClick={() => setQaOpen((v) => !v)}
            >
              {qaOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <strong>QA Checklist</strong>
              <span className="idw__copy-block-hint">Platform-adapted test checklist</span>
            </button>
            <button
              type="button"
              className="idw__copy-btn"
              onClick={() => copyText('qa', qaChecklist)}
            >
              {copied.qa ? <><Check size={12} />Copied</> : <><Copy size={12} />Copy</>}
            </button>
          </div>
          {qaOpen && <pre className="idw__preview">{qaChecklist}</pre>}
        </div>

        {/* Release Note */}
        <div className="idw__copy-block">
          <div className="idw__copy-block-header">
            <button
              type="button"
              className="idw__copy-block-toggle"
              onClick={() => setNoteOpen((v) => !v)}
            >
              {noteOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <strong>Release Note</strong>
              <span className="idw__copy-block-hint">Short internal release note</span>
            </button>
            <button
              type="button"
              className="idw__copy-btn"
              onClick={() => copyText('note', releaseNote)}
            >
              {copied.note ? <><Check size={12} />Copied</> : <><Copy size={12} />Copy</>}
            </button>
          </div>
          {noteOpen && <pre className="idw__preview">{releaseNote}</pre>}
        </div>
      </section>
    </div>
  )
}
