/**
 * githubWebhookService.js
 *
 * Handles incoming GitHub webhook payloads for pull_request events.
 *
 * Security:
 *  - Verifies HMAC SHA-256 signature using GITHUB_WEBHOOK_SECRET.
 *  - If GITHUB_WEBHOOK_SECRET is not configured, rejects the request cleanly.
 *  - Uses crypto.timingSafeEqual to prevent timing attacks.
 *  - Never exposes the secret.
 *
 * Issue matching:
 *  - Scans PR title, branch name, and body for Life Smile issue keys:
 *    WEB-N, AND-N, IOS-N, API-N, UX-N, BI-N
 *  - The numeric part is the project_tasks.id (keys are display-only in frontend).
 *  - Updates dev_meta for all matched tasks.
 *
 * Phase 7B: no automatic issue status changes — only dev_meta + activity.
 */
'use strict'

const crypto = require('crypto')
const { query } = require('../db')
const { logActivity } = require('./taskActivityService')

// ── Constants ─────────────────────────────────────────────────────────────────

const ISSUE_KEY_RE = /\b(WEB|AND|IOS|API|UX|BI)-(\d+)\b/gi

const SUPPORTED_ACTIONS = new Set([
  'opened',
  'edited',
  'synchronize',
  'ready_for_review',
  'closed',
  'reopened',
])

// ── Signature verification ────────────────────────────────────────────────────

/**
 * Get the configured webhook secret. Returns null if not set.
 */
function getWebhookSecret() {
  const s = process.env.GITHUB_WEBHOOK_SECRET
  return s && s.trim() ? s.trim() : null
}

/**
 * Verify X-Hub-Signature-256 against raw body bytes.
 * Throws with a descriptive message if verification fails.
 *
 * @param {Buffer} rawBody
 * @param {string|undefined} signatureHeader  – value of X-Hub-Signature-256
 */
function verifySignature(rawBody, signatureHeader) {
  const secret = getWebhookSecret()

  if (!secret) {
    const err = new Error(
      'GITHUB_WEBHOOK_SECRET is not configured. Webhook requests will not be processed.'
    )
    err.code = 'WEBHOOK_SECRET_MISSING'
    throw err
  }

  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    const err = new Error('Missing or malformed X-Hub-Signature-256 header.')
    err.code = 'WEBHOOK_SIGNATURE_MISSING'
    throw err
  }

  const receivedHex = signatureHeader.slice('sha256='.length)
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  // Pad to same length before timingSafeEqual (they should already be equal length for valid hex)
  const expectedBuf = Buffer.from(expected,     'hex')
  const receivedBuf = Buffer.from(receivedHex,  'hex')

  // Length mismatch always means invalid — but we must still avoid short-circuit timing leak
  if (expectedBuf.length !== receivedBuf.length) {
    const err = new Error('Invalid webhook signature.')
    err.code = 'WEBHOOK_SIGNATURE_INVALID'
    throw err
  }

  if (!crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    const err = new Error('Invalid webhook signature.')
    err.code = 'WEBHOOK_SIGNATURE_INVALID'
    throw err
  }
}

// ── Status mapping ────────────────────────────────────────────────────────────

/**
 * Map GitHub PR action + PR state to our internal prStatus vocabulary.
 */
function mapPrStatus(action, pr) {
  if (pr.draft) return 'draft'

  switch (action) {
    case 'opened':
    case 'reopened':
      return 'open'

    case 'edited':
    case 'synchronize':
      return pr.draft ? 'draft' : 'open'

    case 'ready_for_review':
      return 'in_review'

    case 'closed':
      return pr.merged ? 'merged' : 'closed'

    default:
      return 'open'
  }
}

// ── Activity description ──────────────────────────────────────────────────────

function activityLabel(action, pr) {
  if (action === 'closed' && pr.merged) return 'GitHub PR merged'
  if (action === 'closed')              return 'GitHub PR closed'
  if (action === 'opened')              return 'GitHub PR opened'
  if (action === 'reopened')            return 'GitHub PR reopened'
  if (action === 'ready_for_review')    return 'GitHub PR ready for review'
  return 'GitHub PR updated'
}

// ── Issue key extraction ──────────────────────────────────────────────────────

/**
 * Scan text for Life Smile issue key patterns and return unique numeric IDs.
 * @param  {...string} texts
 * @returns {number[]}  unique task IDs (numeric part of the key)
 */
function extractTaskIds(...texts) {
  const ids = new Set()
  for (const text of texts) {
    if (!text) continue
    const str = String(text)
    let m
    ISSUE_KEY_RE.lastIndex = 0
    while ((m = ISSUE_KEY_RE.exec(str)) !== null) {
      ids.add(parseInt(m[2], 10))
    }
  }
  return [...ids]
}

// ── Core processing ───────────────────────────────────────────────────────────

/**
 * Process a verified pull_request webhook payload.
 *
 * @param {string} action  – GitHub action field
 * @param {object} payload – full webhook payload
 * @returns {Promise<{ matched: number[], skipped: string }>}
 */
async function processPullRequestEvent(action, payload) {
  if (!SUPPORTED_ACTIONS.has(action)) {
    return { matched: [], skipped: `unsupported action: ${action}` }
  }

  const pr = payload.pull_request
  if (!pr) {
    return { matched: [], skipped: 'payload missing pull_request object' }
  }

  const repo = payload.repository
    ? `${payload.repository.owner.login}/${payload.repository.name}`
    : 'unknown/unknown'

  // Extract task IDs from PR title, branch, and body
  const taskIds = extractTaskIds(pr.title, pr.head?.ref, pr.body)
  if (taskIds.length === 0) {
    return { matched: [], skipped: 'no Life Smile issue key found in PR title/branch/body' }
  }

  const prStatus = mapPrStatus(action, pr)

  const metaPatch = {
    prUrl:             pr.html_url   || '',
    prStatus,
    prTitle:           pr.title      || '',
    prNumber:          pr.number,
    repo,
    branchName:        pr.head?.ref  || '',
    commitRef:         pr.head?.sha  ? pr.head.sha.slice(0, 7) : '',
    githubUpdatedAt:   pr.updated_at || null,
    lastWebhookAction: action,
  }

  const label = activityLabel(action, pr)
  const matched = []

  for (const taskId of taskIds) {
    // Confirm task exists
    const exists = await query(
      'SELECT id FROM project_tasks WHERE id = $1',
      [taskId]
    )
    if (!exists.rows.length) continue

    // Merge dev_meta
    await query(
      `UPDATE project_tasks
          SET dev_meta   = dev_meta || $1::jsonb,
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(metaPatch), taskId]
    )

    // Log activity (no user actor for webhooks)
    await logActivity(
      taskId,
      null,        // actorUserId — GitHub, not a user
      'dev_meta_updated',
      null,
      null,
      { summary: `${label}: ${repo}#${pr.number} (${prStatus})` }
    )

    matched.push(taskId)
  }

  return { matched, skipped: matched.length === 0 ? 'no tasks found for extracted IDs' : null }
}

module.exports = {
  verifySignature,
  processPullRequestEvent,
  extractTaskIds,       // exported for unit tests
  mapPrStatus,          // exported for unit tests
  getWebhookSecret,
}
