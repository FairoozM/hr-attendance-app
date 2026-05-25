/**
 * QA approval logic for issues.
 * Stores approval data in dev_meta.qaApproval (JSONB shallow-merge compatible).
 *
 * The backend fetches current dev_meta before any write so the full
 * qaApproval object is preserved through the JSONB || merge.
 */
const { query } = require('../db')
const projectTasksService = require('./projectTasksService')
const taskActivityService = require('./taskActivityService')

async function getTaskForProject(taskId, projectId) {
  const res = await query(
    `SELECT id, dev_meta, status FROM project_tasks WHERE id = $1 AND project_id = $2`,
    [taskId, projectId]
  )
  if (!res.rows.length) {
    const err = new Error('Issue not found.')
    err.code = 'NOT_FOUND'
    throw err
  }
  return res.rows[0]
}

/**
 * Approve QA for an issue.
 * Stores full qaApproval in dev_meta; optionally moves status to "QA Approved".
 */
async function approveQA(taskId, projectId, { notes = '', moveToQaApproved = true }, actorUserId) {
  const row = await getTaskForProject(taskId, projectId)
  const currentQA = row.dev_meta?.qaApproval || {}

  const qaApproval = {
    ...currentQA,
    approved:   true,
    approvedBy: actorUserId || null,
    approvedAt: new Date().toISOString(),
    notes:      notes !== '' ? notes : (currentQA.notes || ''),
  }

  const updates = { dev_meta: { qaApproval } }
  if (moveToQaApproved) updates.status = 'QA Approved'

  const updated = await projectTasksService.updateTask(taskId, updates, actorUserId)
  await taskActivityService.logActivity(
    taskId, actorUserId || null, 'qa_approved', null, null,
    { summary: 'QA approved' }
  ).catch(() => {})
  return updated
}

/**
 * Revoke QA approval for an issue.
 * Clears approval fields but preserves notes.
 */
async function revokeQA(taskId, projectId, actorUserId) {
  const row = await getTaskForProject(taskId, projectId)
  const currentQA = row.dev_meta?.qaApproval || {}

  const qaApproval = {
    approved:   false,
    approvedBy: null,
    approvedAt: null,
    notes:      currentQA.notes || '',
  }

  const updated = await projectTasksService.updateTask(
    taskId, { dev_meta: { qaApproval } }, actorUserId
  )
  await taskActivityService.logActivity(
    taskId, actorUserId || null, 'qa_revoked', null, null,
    { summary: 'QA approval revoked' }
  ).catch(() => {})
  return updated
}

module.exports = { approveQA, revokeQA }
