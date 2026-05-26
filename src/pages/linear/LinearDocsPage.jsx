/**
 * LinearDocsPage.jsx
 * /#/projects/linear/docs
 *
 * Product Docs / Knowledge Base for Life Smile dev teams.
 * Shared data persisted to backend (Phase 14A). Falls back to localStorage on API error.
 */
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  BookOpen, Plus, Search, X, Edit2, Copy, CheckCircle2, Trash2,
  Tag, Calendar, FileText, ChevronDown, Globe, Smartphone, Server,
  PenTool, BarChart2, Rocket, Shield, AlertTriangle, BookMarked,
  Save, ArrowLeft, Wifi, WifiOff,
} from 'lucide-react'
import { getWorkflowHints } from '../../lib/linearDocsMatcher'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import WorkspaceMigrationBanner from '../../components/linear/WorkspaceMigrationBanner'
import {
  listDocsApi, createDocApi, updateDocApi, deleteDocApi,
  isMigrated, markMigrated,
} from '../../lib/linearWorkspaceApi'
import { canManageDocs, LINEAR_PERMISSION_DENIED_MESSAGE } from '../../lib/linearPermissions'
import './LinearDocsPage.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'lifesmile.linear.docs.v1'

export const CATEGORIES = [
  { key: 'Website',       Icon: Globe,          color: '#3b82f6' },
  { key: 'Android App',   Icon: Smartphone,     color: '#10b981' },
  { key: 'iOS App',       Icon: Smartphone,     color: '#6366f1' },
  { key: 'Backend/API',   Icon: Server,         color: '#f59e0b' },
  { key: 'UX/UI',         Icon: PenTool,        color: '#ec4899' },
  { key: 'Data & BI',     Icon: BarChart2,      color: '#8b5cf6' },
  { key: 'Releases',      Icon: Rocket,         color: '#0891b2' },
  { key: 'QA',            Icon: Shield,         color: '#059669' },
  { key: 'Troubleshooting',Icon: AlertTriangle,  color: '#ef4444' },
  { key: 'SOP',           Icon: BookMarked,     color: '#7c3aed' },
]

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]))

function catColor(key) { return CATEGORY_MAP[key]?.color || '#9ca3af' }

// ── Starter docs ─────────────────────────────────────────────────────────────

function makeId() {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function makeStarter(fields) {
  const now = new Date().toISOString()
  return { ...fields, id: makeId(), createdAt: now, updatedAt: now }
}

const STARTER_DOCS = [
  makeStarter({
    title: 'Website QA Checklist',
    category: 'QA',
    tags: ['website', 'qa', 'checklist', 'lifesmile.ae'],
    summary: 'Standard QA checklist for lifesmile.ae before any release.',
    content: `# Website QA Checklist — lifesmile.ae

## Homepage
- [ ] Hero banner loads correctly (desktop + mobile)
- [ ] Navigation links all functional
- [ ] Search bar returns relevant results
- [ ] Category tiles load with correct images
- [ ] Promotions / banners display correctly

## Product Listing
- [ ] Filter and sort work correctly
- [ ] Pagination or infinite scroll works
- [ ] Product images load without error
- [ ] Prices display in AED correctly
- [ ] "Add to cart" works from listing

## Product Page
- [ ] All product images visible and zoomable
- [ ] SKU / variant selector works
- [ ] Stock status displayed correctly
- [ ] "Add to cart" adds correct SKU/quantity
- [ ] Breadcrumbs correct

## Cart
- [ ] Correct items shown
- [ ] Quantity edit and remove work
- [ ] Subtotal and totals correct
- [ ] Promo/discount code applies correctly
- [ ] "Proceed to checkout" navigates correctly

## Checkout
- [ ] Address form saves and validates
- [ ] Payment options displayed correctly
- [ ] Order summary matches cart
- [ ] Confirmation email sent on order place
- [ ] Order appears in admin panel

## Mobile (iOS Safari + Android Chrome)
- [ ] Layout not broken at 375px and 390px
- [ ] Touch targets ≥ 44px
- [ ] No horizontal scroll on mobile

## Performance
- [ ] Lighthouse score ≥ 70 on mobile
- [ ] No broken images or 404s in console
- [ ] No JavaScript errors in console`,
  }),
  makeStarter({
    title: 'Checkout Smoke Test',
    category: 'QA',
    tags: ['checkout', 'smoke-test', 'payment', 'website'],
    summary: 'Quick smoke test for the checkout flow after any deployment.',
    content: `# Checkout Smoke Test

Run after every deployment that touches cart, checkout, or payment code.

## Steps

1. Open lifesmile.ae in incognito/private window
2. Search for a test product (e.g. "Vitamin C")
3. Open product page → select a variant → click "Add to Cart"
4. Verify cart badge increments
5. Open cart → verify item, price, and quantity correct
6. Proceed to checkout
7. Enter test shipping address (use test account if available)
8. Select Cash on Delivery payment (safe for smoke test)
9. Place order → verify confirmation page shows order number
10. Check admin panel (Zoho / backend) for new order record
11. Check that confirmation email was received (optional)

## Pass criteria
- No JavaScript errors
- Order placed successfully with correct totals
- Order visible in admin

## Fail actions
- If order fails: check console for errors, notify backend team
- If payment gateway error: do not rollback immediately — check logs first
- Log in #dev-alerts with screenshot`,
  }),
  makeStarter({
    title: 'Product Page QA Checklist',
    category: 'QA',
    tags: ['product-page', 'qa', 'website', 'images'],
    summary: 'Checklist for QA of individual product pages on lifesmile.ae.',
    content: `# Product Page QA Checklist

## Content
- [ ] Product title correct and fully visible
- [ ] Description formatted correctly (no HTML artifacts)
- [ ] All product images load without error
- [ ] Image gallery / carousel works
- [ ] Image zoom / lightbox works on desktop

## Pricing & Stock
- [ ] Price in AED shown correctly
- [ ] "Sale" badge shows if product is on promotion
- [ ] Out-of-stock message shown if applicable
- [ ] Quantity selector min/max enforced

## Variants
- [ ] All variants (size, flavour, etc.) listed
- [ ] Selecting variant updates price and image correctly
- [ ] Unavailable variants are greyed out or hidden

## Cart
- [ ] "Add to Cart" adds selected variant and quantity
- [ ] Mini-cart or cart page updates immediately
- [ ] No duplicate items added on double-click

## SEO / Meta
- [ ] Page title includes product name
- [ ] Meta description present
- [ ] Canonical URL correct

## Mobile
- [ ] Images fit screen without overflow
- [ ] CTA button ("Add to Cart") visible above fold or pinned at bottom`,
  }),
  makeStarter({
    title: 'Android Release Checklist',
    category: 'Android App',
    tags: ['android', 'release', 'play-store', 'checklist'],
    summary: 'Step-by-step checklist for releasing the Life Smile Android app to Google Play.',
    content: `# Android Release Checklist

## Pre-build
- [ ] All release issues are in "QA Approved" or "Done"
- [ ] Version name and version code updated in build.gradle
- [ ] Release notes / What's New written (for store listing)
- [ ] Debug logs removed or disabled
- [ ] Proguard/R8 rules verified (no crashes from obfuscation)

## Build
- [ ] Run release build: ./gradlew bundleRelease
- [ ] AAB (Android App Bundle) generated successfully
- [ ] Sign with production keystore (NOT debug key)
- [ ] Verify signing: apksigner verify --print-certs app-release.aab

## Testing
- [ ] Install release APK on physical device (Samsung + Pixel if available)
- [ ] Run checkout smoke test on device
- [ ] Verify push notifications still work
- [ ] Verify deep links work (e.g. /product/:id)
- [ ] No crash on cold start
- [ ] Firebase Crashlytics — no new crashes in pre-release

## Google Play Console
- [ ] Upload AAB to Play Console
- [ ] Check for policy violations in Play Console
- [ ] Update store listing screenshots if needed
- [ ] Set rollout to Internal > then Closed Testing > then Production
- [ ] Staged rollout: start at 10%, monitor for 24h

## Post-release
- [ ] Monitor Crashlytics for new crashes
- [ ] Monitor Play Console reviews
- [ ] Notify team in #releases channel
- [ ] Update Mobile Release Tracker with release date`,
  }),
  makeStarter({
    title: 'iOS Release Checklist',
    category: 'iOS App',
    tags: ['ios', 'release', 'app-store', 'checklist', 'testflight'],
    summary: 'Step-by-step checklist for releasing the Life Smile iOS app to the App Store.',
    content: `# iOS Release Checklist

## Pre-build
- [ ] All release issues are in "QA Approved" or "Done"
- [ ] Version and build number updated in Xcode
- [ ] Release notes written (What's New in this version)
- [ ] All debug/test code removed
- [ ] App Transport Security settings correct

## Build
- [ ] Archive build: Product → Archive in Xcode
- [ ] Validate archive (no errors)
- [ ] Upload to App Store Connect
- [ ] Build appears in App Store Connect TestFlight

## TestFlight
- [ ] Internal testers install and verify basic flows
- [ ] Checkout smoke test on iOS (iPhone + iPad if applicable)
- [ ] Push notifications work
- [ ] Deep links work
- [ ] No crash on cold start
- [ ] No ANR-like hangs

## App Store Connect
- [ ] Screenshots up to date (if UI changed)
- [ ] App Preview video updated if needed
- [ ] Privacy policy URL valid
- [ ] Age rating correct
- [ ] Submit for review (allow 24-48h for Apple review)

## Post-release
- [ ] Monitor Crashlytics / Xcode Organizer
- [ ] Monitor App Store reviews
- [ ] Notify team in #releases channel
- [ ] Update Mobile Release Tracker with release date`,
  }),
  makeStarter({
    title: 'Backend Deployment Checklist',
    category: 'Backend/API',
    tags: ['backend', 'deployment', 'api', 'checklist', 'server'],
    summary: 'Standard checklist for deploying Life Smile backend/API to production.',
    content: `# Backend Deployment Checklist

## Pre-deployment
- [ ] All release issues are "QA Approved" or "Done"
- [ ] Run full test suite locally: npm test (or equivalent)
- [ ] Review migration files — verify all are additive (no destructive changes)
- [ ] Confirm .env variables for production are set (secrets, API keys)
- [ ] PR reviewed and approved
- [ ] Deployment window confirmed with team

## Database
- [ ] Backup production database before deploying
- [ ] Test migration on staging with production data copy
- [ ] Verify migration is reversible (or have rollback plan)
- [ ] Check for long-running migration (may need maintenance window)

## Deployment
- [ ] Run: npm run deploy:backend (or SSH deploy command)
- [ ] Watch deploy logs for errors
- [ ] Verify new version running: GET /api/health or version endpoint
- [ ] Run smoke test: POST /api/auth/login works, GET /api/projects works

## Post-deployment
- [ ] Check error logs (CloudWatch / Sentry / server logs) for 5 min
- [ ] Verify frontend still connects correctly
- [ ] Run checkout smoke test end-to-end
- [ ] Update deployment record in Web Deployment Tracker
- [ ] Notify team in #deploys channel

## Rollback
If critical error found within 30 min:
- [ ] Revert commit: git revert HEAD
- [ ] Re-deploy previous build
- [ ] Restore database backup if migration was destructive
- [ ] Post-mortem within 24h`,
  }),
  makeStarter({
    title: 'CloudFront / CDN Deployment Notes',
    category: 'Backend/API',
    tags: ['cloudfront', 'cdn', 'aws', 's3', 'deployment', 'cache'],
    summary: 'Notes for deploying frontend changes and managing CloudFront cache invalidation.',
    content: `# CloudFront / CDN Deployment Notes

## Frontend Deployment
The frontend (Vite build) is deployed to S3 and served via CloudFront.

## Deploy steps
\`\`\`bash
npm run build           # Build production bundle
npm run deploy:frontend # Sync dist/ to S3 + create CF invalidation
\`\`\`

Or manually:
\`\`\`bash
aws s3 sync dist/ s3://BUCKET_NAME --delete
aws cloudfront create-invalidation --distribution-id DIST_ID --paths "/*"
\`\`\`

## Cache invalidation
- Always invalidate after a deployment: paths "/*"
- Invalidation takes 30–60 seconds
- Verify by checking dist/index.html has updated hash in HTML source

## Common issues

### Old version still showing after deploy
1. Confirm S3 sync completed successfully
2. Confirm CloudFront invalidation was created (check AWS Console)
3. Wait 60s then hard refresh (Cmd+Shift+R)
4. If still old version, check browser cache (use incognito)

### Large assets (images) not updating
- S3 asset URLs are versioned via Vite content hash — no cache issue expected
- If custom uploaded assets, invalidate specific path: /uploads/*

### 403 or 404 on SPA routes
- Ensure CloudFront error pages → 403/404 → /index.html → 200
- This allows React Router to handle all routes client-side

## Environment variables
- API_BASE_URL must be set before build: VITE_API_BASE_URL=https://api.example.com npm run build
- Do not commit .env files`,
  }),
  makeStarter({
    title: 'GitHub PR Workflow',
    category: 'SOP',
    tags: ['github', 'pr', 'workflow', 'code-review', 'git'],
    summary: 'Standard operating procedure for opening, reviewing, and merging GitHub PRs.',
    content: `# GitHub PR Workflow

## Branch naming
Use the issue key in the branch name:
\`\`\`
feature/WEB-23-checkout-redesign
fix/AND-15-push-notification
chore/API-8-upgrade-node
\`\`\`

## Opening a PR
1. Branch from main (or the active release branch)
2. Write meaningful commit messages (present tense: "Add checkout redesign")
3. Open PR on GitHub with:
   - Title: [ISSUE-KEY] Short description
   - Body: What changed, why, and how to test
   - Link to the issue key (e.g. WEB-23)
4. Assign reviewer(s)
5. Link PR URL in the issue Dev tab (Linear tracker)

## PR review standards
- Reviewer must leave at least one comment or approval
- No PR merged without at least 1 approval
- All CI checks must pass before merge
- Keep PR size reasonable (< 400 lines changed is ideal)

## Merging
- Use "Squash and merge" for feature branches
- Use "Merge commit" for release branches
- Delete branch after merge

## Syncing to issue tracker
After merging, update the issue:
1. In the Dev tab, set PR status to "Merged"
2. Move issue to "Ready for Release" if QA approved
3. Add release note if applicable`,
  }),
  makeStarter({
    title: 'Intake to Issue Workflow',
    category: 'SOP',
    tags: ['intake', 'workflow', 'process', 'issue-creation'],
    summary: 'How product requests and bug reports flow from intake to tracked issues.',
    content: `# Intake to Issue Workflow

## Step 1: Capture in Intake Hub
All new requests (features, bugs, ideas) start in the Intake Hub:
- Route: /#/projects/linear/intake
- Fill: Title, Type, Team, Priority, Description, Reporter

## Step 2: Triage (daily/weekly)
Review intake items and decide:
- Accept → convert to Issue
- Reject → decline with reason
- Defer → leave in intake with comment

## Step 3: Convert to Issue
When accepting:
1. Open intake item
2. Click "Create Issue" or "Accept"
3. Assign to correct project and team
4. Set: Status = Backlog, Priority, Assignee, Cycle (if applicable)
5. Add labels (bug, feature, enhancement, etc.)
6. Link to parent epic if applicable

## Step 4: Assign to Cycle
Add issue to the active Cycle:
- Route: /#/projects/linear → cycle filter

## Step 5: Dev picks up
Developer opens issue → reads description → opens Dev tab → creates branch

## Step 6: In Progress
Developer updates status to "In Progress" when work begins.

## Step 7: Review
When ready: open PR → link PR in Dev tab → move to "In Review"

## Step 8: QA
QA opens QA tab → verifies → attaches evidence → Approve or Revoke

## Step 9: Release
Move to "Ready for Release" after QA Approved.
Include in next release batch.`,
  }),
  makeStarter({
    title: 'Release Approval Workflow',
    category: 'Releases',
    tags: ['release', 'workflow', 'approval', 'deployment', 'sign-off'],
    summary: 'How releases are approved and deployed for Life Smile products.',
    content: `# Release Approval Workflow

## Overview
Before any release goes live, it must complete this workflow:

## Stage 1: Issues Ready
All issues for the release must be:
- Status: "Ready for Release" or "QA Approved"
- QA evidence attached (screenshots / test results)
- No open PRs (or PRs merged and confirmed)

## Stage 2: QA Sign-off
For each issue:
1. Open issue → QA tab
2. Review evidence and suggested QA steps
3. Run smoke tests as applicable
4. Click "Approve QA" to confirm
5. Issues should now show "QA Approved" status

## Stage 3: Release Batch Approval
Open Releases page → Release Approval Panel:
1. Confirm readiness checklist
2. Fill release name, type (Major / Minor / Patch), environment
3. Note any special deployment needs (DB migration, cache clear, etc.)
4. Click "Mark Release Approved"
5. Copy Release Summary for team channel

## Stage 4: Deploy
- Website/backend: run deployment checklist → update Web Deployment Tracker
- Mobile: upload to store → update Mobile Release Tracker
- Click "Mark Deployed" in Release Approval Panel

## Stage 5: Smoke Test
After deployment:
1. Run Checkout Smoke Test
2. Run app smoke test (open app, check main flows)
3. Check error logs for 15 minutes

## Stage 6: Done
- Move all released issues to "Done"
- Post release note in team channel
- Archive the release batch`,
  }),
]

// ── localStorage helpers (used as cache / fallback) ──────────────────────────

function loadDocs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.docs) ? parsed.docs : null
  } catch {
    return null
  }
}

function saveDocs(docs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ docs }))
  } catch {
    console.warn('[docs] localStorage save failed')
  }
}

function getInitialDocs() {
  const stored = loadDocs()
  return stored ?? STARTER_DOCS
}

// ── Backend ↔ frontend field normalizers ─────────────────────────────────────

/** Backend (snake_case) → frontend (camelCase) */
function normalizeDoc(row) {
  if (!row) return null
  return {
    id:             row.id,
    title:          row.title || '',
    category:       row.category || 'QA',
    tags:           row.tags || [],
    summary:        row.summary || '',
    content:        row.content || '',
    relatedProject: row.related_project_name || '',
    relatedLabels:  row.related_labels || [],
    createdAt:      row.created_at || row.createdAt || new Date().toISOString(),
    updatedAt:      row.updated_at || row.updatedAt || new Date().toISOString(),
  }
}

/** Frontend (camelCase) → backend (snake_case) */
function denormalizeDoc(doc) {
  return {
    title:          doc.title,
    category:       doc.category,
    tags:           Array.isArray(doc.tags) ? doc.tags
                      : (doc.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    summary:        doc.summary || '',
    content:        doc.content || '',
    related_labels: Array.isArray(doc.relatedLabels) ? doc.relatedLabels
                      : (doc.relatedLabels || '').split(',').map(t => t.trim()).filter(Boolean),
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmtDate(str) {
  if (!str) return '—'
  try {
    const d = new Date(str)
    return d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

function fmtDateShort(str) {
  if (!str) return '—'
  try {
    const d = new Date(str)
    const now = new Date()
    const diffDays = Math.floor((now - d) / 86400000)
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7)  return `${diffDays}d ago`
    return d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })
  } catch { return '—' }
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true }
  catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
      return true
    } catch { return false }
  }
}

// ── Doc Card ──────────────────────────────────────────────────────────────────

function DocCard({ doc, onEdit, onCopy, canEdit = true }) {
  const [copied, setCopied] = useState(false)
  const catCfg = CATEGORY_MAP[doc.category] || {}
  const CatIcon = catCfg.Icon || FileText
  const color   = catCfg.color || '#9ca3af'

  const handleCopy = async (e) => {
    e.stopPropagation()
    await copyText(doc.content || doc.summary || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
    if (onCopy) onCopy()
  }

  return (
    <div className="doc-card" onClick={() => onEdit(doc)} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onEdit(doc)}>
      <div className="doc-card__header">
        <span className="doc-card__cat-badge" style={{ '--cat': color }}>
          <CatIcon size={11} />
          {doc.category}
        </span>
        <button type="button" className={`doc-card__copy-btn ${copied ? 'doc-card__copy-btn--copied' : ''}`}
          onClick={handleCopy} title="Copy content">
          {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
        </button>
      </div>

      <h3 className="doc-card__title">{doc.title}</h3>

      {doc.summary && <p className="doc-card__summary">{doc.summary}</p>}

      {doc.tags?.length > 0 && (
        <div className="doc-card__tags">
          {doc.tags.slice(0, 4).map(t => (
            <span key={t} className="doc-card__tag">{t}</span>
          ))}
        </div>
      )}

      {(() => {
        const hints = getWorkflowHints(doc.title)
        return hints.length > 0 ? (
          <div className="doc-card__workflow-hints">
            {hints.map(h => (
              <span key={h} className="doc-card__workflow-hint">{h}</span>
            ))}
          </div>
        ) : null
      })()}

      <div className="doc-card__footer">
        <span className="doc-card__date">
          <Calendar size={10} /> {fmtDateShort(doc.updatedAt)}
        </span>
        <button type="button" className="doc-card__edit-btn" onClick={e => { e.stopPropagation(); onEdit(doc) }}>
          <Edit2 size={11} /> {canEdit ? 'Edit' : 'View'}
        </button>
      </div>
    </div>
  )
}

// ── Doc Editor Modal ──────────────────────────────────────────────────────────

const EMPTY_FORM = {
  title: '', category: 'QA', tags: '', summary: '', content: '',
  relatedProject: '', relatedLabels: '',
}

function DocEditorModal({ doc, onSave, onDelete, onClose, readOnly = false }) {
  const isNew = !doc?.id
  const [form, setForm] = useState(() => {
    if (!doc) return EMPTY_FORM
    return {
      title:          doc.title || '',
      category:       doc.category || 'QA',
      tags:           (doc.tags || []).join(', '),
      summary:        doc.summary || '',
      content:        doc.content || '',
      relatedProject: doc.relatedProject || '',
      relatedLabels:  (doc.relatedLabels || []).join(', '),
    }
  })
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [copied, setCopied] = useState(false)
  const titleRef = useRef(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))

  const handleSave = () => {
    if (readOnly) return
    if (!form.title.trim()) { titleRef.current?.focus(); return }
    const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean)
    const relatedLabels = form.relatedLabels.split(',').map(t => t.trim()).filter(Boolean)
    const now = new Date().toISOString()
    const saved = {
      ...(doc || { id: makeId(), createdAt: now }),
      title:          form.title.trim(),
      category:       form.category,
      tags,
      summary:        form.summary.trim(),
      content:        form.content,
      relatedProject: form.relatedProject.trim(),
      relatedLabels,
      updatedAt:      now,
    }
    onSave(saved)
  }

  const handleCopyContent = async () => {
    await copyText(form.content || form.summary || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="dem__overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dem" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="dem__header">
          <h2 className="dem__title">{isNew ? 'New Doc' : 'Edit Doc'}</h2>
          <div className="dem__header-actions">
            <button type="button" className={`dem__copy-btn ${copied ? 'dem__copy-btn--copied' : ''}`}
              onClick={handleCopyContent} title="Copy content">
              {copied ? <><CheckCircle2 size={12} /> Copied!</> : <><Copy size={12} /> Copy Content</>}
            </button>
            <button type="button" className="dem__close-btn" onClick={onClose}><X size={15} /></button>
          </div>
        </div>

        {/* Body */}
        <div className="dem__body">
          <div className="dem__row dem__row--2col">
            <div className="dem__field">
              <label className="dem__label">Title *</label>
              <input ref={titleRef} className="dem__input" value={form.title} onChange={set('title')}
                disabled={readOnly}
                placeholder="Doc title" maxLength={120} />
            </div>
            <div className="dem__field">
              <label className="dem__label">Category</label>
              <select className="dem__select" value={form.category} onChange={set('category')} disabled={readOnly}>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.key}</option>)}
              </select>
            </div>
          </div>

          <div className="dem__field">
            <label className="dem__label">Summary</label>
            <input className="dem__input" value={form.summary} onChange={set('summary')} disabled={readOnly}
              placeholder="One sentence description" maxLength={200} />
          </div>

          <div className="dem__row dem__row--2col">
            <div className="dem__field">
              <label className="dem__label">Tags <span className="dem__label-hint">(comma-separated)</span></label>
              <input className="dem__input" value={form.tags} onChange={set('tags')} disabled={readOnly}
                placeholder="qa, checklist, website" />
            </div>
            <div className="dem__field">
              <label className="dem__label">Related Project</label>
              <input className="dem__input" value={form.relatedProject} onChange={set('relatedProject')} disabled={readOnly}
                placeholder="Life Smile Website" />
            </div>
          </div>

          <div className="dem__field dem__field--full">
            <label className="dem__label">
              Content
              <span className="dem__label-hint"> — plain text or markdown checklist (- [ ] item)</span>
            </label>
            <textarea className="dem__textarea" value={form.content} onChange={set('content')} disabled={readOnly}
              placeholder="Write the doc content here. Use - [ ] for checklist items." rows={18} />
          </div>
        </div>

        {/* Footer */}
        <div className="dem__footer">
          <div className="dem__footer-left">
            {!readOnly && !isNew && !deleteConfirm && (
              <button type="button" className="dem__delete-btn" onClick={() => setDeleteConfirm(true)}>
                <Trash2 size={13} /> Delete
              </button>
            )}
            {!readOnly && !isNew && deleteConfirm && (
              <>
                <span className="dem__delete-confirm-msg">Delete this doc?</span>
                <button type="button" className="dem__delete-confirm-btn" onClick={() => onDelete(doc.id)}>
                  Yes, delete
                </button>
                <button type="button" className="dem__delete-cancel-btn" onClick={() => setDeleteConfirm(false)}>
                  Cancel
                </button>
              </>
            )}
          </div>
          <div className="dem__footer-right">
            <button type="button" className="dem__cancel-btn" onClick={onClose}>Cancel</button>
            {!readOnly ? (
              <button type="button" className="dem__save-btn" onClick={handleSave}>
                <Save size={13} /> {isNew ? 'Create Doc' : 'Save Changes'}
              </button>
            ) : (
              <span className="dem__label-hint">{LINEAR_PERMISSION_DENIED_MESSAGE}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LinearDocsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [docs,         setDocs]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [backendError, setBackendError] = useState(false)
  const [showMigration, setShowMigration] = useState(false)
  const [search,       setSearch]       = useState('')
  const [catFilter,    setCatFilter]    = useState('all')
  const [editDoc,      setEditDoc]      = useState(null)
  const [showEditor,   setShowEditor]   = useState(false)
  const canEditDocs = canManageDocs(user)

  // Load from backend on mount; fall back to localStorage on error
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await listDocsApi()
        if (cancelled) return
        const normalized = (rows || []).map(normalizeDoc)
        setDocs(normalized)
        saveDocs(normalized) // keep localStorage cache in sync for linearDocsMatcher
        if (normalized.length === 0 && !isMigrated()) {
          const local = loadDocs()
          if (local?.length > 0) setShowMigration(true)
        }
      } catch (err) {
        if (cancelled) return
        console.error('[LinearDocsPage] backend load failed:', err)
        setBackendError(true)
        const local = loadDocs()
        setDocs(local ?? STARTER_DOCS)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Filtered docs
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return docs.filter(d => {
      if (catFilter !== 'all' && d.category !== catFilter) return false
      if (!q) return true
      return (
        d.title.toLowerCase().includes(q) ||
        d.summary?.toLowerCase().includes(q) ||
        d.content?.toLowerCase().includes(q) ||
        (d.tags || []).some(t => t.toLowerCase().includes(q))
      )
    })
  }, [docs, search, catFilter])

  // Category counts
  const catCounts = useMemo(() => {
    const m = {}
    docs.forEach(d => { m[d.category] = (m[d.category] || 0) + 1 })
    return m
  }, [docs])

  const handleEdit = useCallback((doc) => {
    setEditDoc(doc)
    setShowEditor(true)
  }, [])

  const handleNew = useCallback(() => {
    if (!canEditDocs) return
    setEditDoc(null)
    setShowEditor(true)
  }, [canEditDocs])

  const handleSave = useCallback(async (savedDoc) => {
    if (!canEditDocs) return
    const payload = denormalizeDoc(savedDoc)
    const isLocalId = !savedDoc.id || (typeof savedDoc.id === 'string' && savedDoc.id.startsWith('doc_'))
    try {
      let result
      if (isLocalId) {
        result = normalizeDoc(await createDocApi(payload))
      } else {
        result = normalizeDoc(await updateDocApi(savedDoc.id, payload))
      }
      setDocs(prev => {
        const idx = prev.findIndex(d => d.id === savedDoc.id)
        const next = idx === -1 ? [...prev, result] : prev.map((d, i) => i === idx ? result : d)
        saveDocs(next)
        return next
      })
    } catch (err) {
      console.error('[docs] API save failed, falling back to local:', err)
      setDocs(prev => {
        const idx = prev.findIndex(d => d.id === savedDoc.id)
        const next = idx === -1 ? [...prev, savedDoc] : prev.map((d, i) => i === idx ? savedDoc : d)
        saveDocs(next)
        return next
      })
    }
    setShowEditor(false)
    setEditDoc(null)
  }, [canEditDocs])

  const handleDelete = useCallback(async (id) => {
    if (!canEditDocs) return
    const isLocalId = typeof id === 'string'
    if (!isLocalId) {
      try { await deleteDocApi(id) } catch (err) {
        console.error('[docs] API delete failed:', err)
      }
    }
    setDocs(prev => {
      const next = prev.filter(d => d.id !== id)
      saveDocs(next)
      return next
    })
    setShowEditor(false)
    setEditDoc(null)
  }, [canEditDocs])

  const handleClose = useCallback(() => {
    setShowEditor(false)
    setEditDoc(null)
  }, [])

  const handleMigrateLocal = async () => {
    const localDocs = loadDocs()
    if (!localDocs?.length) return true
    try {
      const results = await Promise.all(
        localDocs.map(d => createDocApi(denormalizeDoc(d)).then(normalizeDoc))
      )
      setDocs(results)
      saveDocs(results)
      markMigrated()
      setShowMigration(false)
      return true
    } catch {
      return false
    }
  }

  return (
    <div className="ldocs">
      <LinearSidebar />

      <div className="ldocs__body">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <header className="ldocs__header">
          <div className="ldocs__header-left">
            <BookOpen size={16} className="ldocs__header-icon" />
            <div>
              <h1 className="ldocs__header-title">Product Docs</h1>
              <p className="ldocs__header-sub">Internal knowledge for website, app, backend, QA, and releases</p>
            </div>
          </div>
          <div className="ldocs__header-right">
            {backendError && (
              <span className="ldocs__offline-badge" title="Using local cache — backend unavailable">
                <WifiOff size={12} /> Local
              </span>
            )}
            <div className="ldocs__search-wrap">
              <Search size={13} className="ldocs__search-icon" />
              <input
                className="ldocs__search"
                placeholder="Search docs…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="ldocs__search-clear" onClick={() => setSearch('')}>
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              type="button"
              className="ldocs__new-btn"
              onClick={handleNew}
              disabled={!canEditDocs}
              title={canEditDocs ? 'Create a new doc' : LINEAR_PERMISSION_DENIED_MESSAGE}
            >
              <Plus size={14} /> New Doc
            </button>
          </div>
        </header>

        {/* ── Migration banner ─────────────────────────────────────────── */}
        {showMigration && (
          <WorkspaceMigrationBanner
            localItemCount={loadDocs()?.length ?? 0}
            resourceLabel="docs"
            onImport={handleMigrateLocal}
            onDismiss={() => { markMigrated(); setShowMigration(false) }}
          />
        )}

        {/* ── Category filter tabs ─────────────────────────────────────── */}
        <div className="ldocs__cats">
          <button
            type="button"
            className={`ldocs__cat-tab ${catFilter === 'all' ? 'ldocs__cat-tab--active' : ''}`}
            onClick={() => setCatFilter('all')}
          >
            All <span className="ldocs__cat-count">{docs.length}</span>
          </button>
          {CATEGORIES.map(({ key, color }) => {
            const cnt = catCounts[key] || 0
            if (catFilter !== 'all' && catFilter !== key && cnt === 0) return null
            return (
              <button
                key={key}
                type="button"
                className={`ldocs__cat-tab ${catFilter === key ? 'ldocs__cat-tab--active' : ''}`}
                style={{ '--ccat': color }}
                onClick={() => setCatFilter(catFilter === key ? 'all' : key)}
              >
                {key}
                {cnt > 0 && <span className="ldocs__cat-count">{cnt}</span>}
              </button>
            )
          })}
        </div>

        {/* ── Doc grid ────────────────────────────────────────────────── */}
        <main className="ldocs__main">
          {loading ? (
            <div className="ldocs__loading">Loading docs…</div>
          ) : filtered.length === 0 ? (
            <div className="ldocs__empty">
              <BookOpen size={32} className="ldocs__empty-icon" />
              <p className="ldocs__empty-title">
                {search || catFilter !== 'all' ? 'No docs match your search' : 'No docs yet'}
              </p>
              <p className="ldocs__empty-sub">
                {search ? 'Try a different search term or clear the filter.' : 'Create your first doc to get started.'}
              </p>
              {!search && catFilter === 'all' && (
                <button
                  type="button"
                  className="ldocs__empty-btn"
                  onClick={handleNew}
                  disabled={!canEditDocs}
                  title={canEditDocs ? 'Create a new doc' : LINEAR_PERMISSION_DENIED_MESSAGE}
                >
                  <Plus size={13} /> Create Doc
                </button>
              )}
            </div>
          ) : (
            <div className="ldocs__grid">
              {filtered.map(doc => (
                <DocCard key={doc.id} doc={doc} onEdit={handleEdit} canEdit={canEditDocs} />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* ── Editor modal ──────────────────────────────────────────────── */}
      {showEditor && (
        <DocEditorModal
          doc={editDoc}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={handleClose}
          readOnly={!canEditDocs}
        />
      )}
    </div>
  )
}
