/**
 * githubPrService.js
 * Server-side GitHub PR metadata fetcher.
 *
 * Uses GITHUB_TOKEN env var — never exposes token to browser.
 * Returns clean JSON errors if token is missing or API fails.
 */
'use strict'

const axios = require('axios')
const { query } = require('../db')
const taskActivityService = require('./taskActivityService')
const { logLinearAudit } = require('./linearAuditService')

const GITHUB_API = 'https://api.github.com'
const PR_URL_RE  = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i

// ── Helpers ──────────────────────────────────────────────────────────────────

function getToken() {
  const t = process.env.GITHUB_TOKEN
  return t && t.trim() ? t.trim() : null
}

/**
 * Parse a GitHub PR URL into { owner, repo, number }.
 * Returns null if the URL does not match the expected pattern.
 */
function parsePrUrl(url = '') {
  const m = String(url).trim().match(PR_URL_RE)
  if (!m) return null
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) }
}

/**
 * Map GitHub PR API response to our internal prStatus vocabulary.
 */
function mapPrStatus(pr) {
  if (pr.draft)                                return 'draft'
  if (pr.state === 'open' && !pr.draft)        return 'open'
  if (pr.state === 'closed' && pr.merged_at)   return 'merged'
  if (pr.state === 'closed' && !pr.merged_at)  return 'closed'
  return 'open'
}

// ── Main service ──────────────────────────────────────────────────────────────

/**
 * Fetch GitHub PR metadata, merge into dev_meta, log activity.
 *
 * @param {{ taskId: number, projectId: number, prUrl: string, actorUserId: number|null }} opts
 * @returns {Promise<{ devMeta: object }>}
 */
async function syncPrMetadata({ taskId, projectId, prUrl, actorUserId }) {
  const token = getToken()
  if (!token) {
    const err = new Error('GitHub integration is not configured. Add GITHUB_TOKEN to the server environment.')
    err.code = 'MISSING_GITHUB_TOKEN'
    throw err
  }

  const parsed = parsePrUrl(prUrl)
  if (!parsed) {
    const err = new Error('Invalid GitHub pull request URL. Expected: https://github.com/owner/repo/pull/123')
    err.code = 'INVALID_PR_URL'
    throw err
  }

  const { owner, repo, number } = parsed
  const apiUrl = `${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}`

  let prData
  try {
    const resp = await axios.get(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'LifeSmile-HR-App/1.0',
      },
      timeout: 10_000,
    })
    prData = resp.data
  } catch (err) {
    const status = err.response?.status
    if (status === 401 || status === 403) {
      const e = new Error('GitHub token is invalid or lacks access to this repository.')
      e.code = 'GITHUB_AUTH_ERROR'
      throw e
    }
    if (status === 404) {
      const e = new Error(`Pull request not found: ${owner}/${repo}#${number}`)
      e.code = 'GITHUB_NOT_FOUND'
      throw e
    }
    if (status === 429 || (err.response?.headers || {})['x-ratelimit-remaining'] === '0') {
      const e = new Error('GitHub API rate limit reached. Try again in a few minutes.')
      e.code = 'GITHUB_RATE_LIMIT'
      throw e
    }
    const e = new Error(`GitHub API request failed: ${err.message || String(err)}`)
    e.code = 'GITHUB_API_ERROR'
    throw e
  }

  const prStatus = mapPrStatus(prData)

  // Build dev_meta update patch
  const metaPatch = {
    prUrl:          prData.html_url || prUrl,
    prStatus,
    prTitle:        prData.title    || '',
    prNumber:       number,
    repo:           `${owner}/${repo}`,
    githubUpdatedAt: prData.updated_at || null,
  }

  // Branch name from PR head ref
  if (prData.head?.ref) {
    metaPatch.branchName = prData.head.ref
  }

  // Latest commit SHA from head
  if (prData.head?.sha) {
    metaPatch.commitRef = prData.head.sha.slice(0, 7)
  }

  // Persist via JSONB merge
  await query(
    `UPDATE project_tasks SET dev_meta = dev_meta || $1::jsonb, updated_at = NOW() WHERE id = $2 AND project_id = $3`,
    [JSON.stringify(metaPatch), taskId, projectId]
  )

  // Read back the full row's dev_meta
  const result = await query(
    `SELECT dev_meta FROM project_tasks WHERE id = $1`,
    [taskId]
  )
  const updatedDevMeta = result.rows[0]?.dev_meta || {}

  // Log activity
  if (actorUserId) {
    await taskActivityService.logActivity(
      taskId,
      actorUserId,
      'dev_meta_updated',
      null,
      null,
      { summary: `GitHub PR synced: ${owner}/${repo}#${number} (${prStatus})` }
    )
  }

  await logLinearAudit({
    entityType: 'github',
    entityId: `${owner}/${repo}#${number}`,
    action: 'github_pr_synced',
    actorUserId,
    summary: `GitHub PR synced for issue ${taskId}: ${owner}/${repo}#${number}`,
    afterSnapshot: {
      repo: `${owner}/${repo}`,
      prNumber: number,
      prStatus,
      taskId,
      projectId,
      devMeta: updatedDevMeta,
    },
    metadata: {
      source: 'manual',
      taskId,
      projectId,
      prUrl: prData.html_url || prUrl,
    },
  })

  return { devMeta: updatedDevMeta }
}

module.exports = { syncPrMetadata, parsePrUrl }
