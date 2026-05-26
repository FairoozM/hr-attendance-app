export type LaunchRecord = {
  id: number
  launchName: string
  launchType: string
  environment: string
  status: string
  linkedIssueIds: number[]
  linkedDeploymentId: number | null
  linkedMobileReleaseId: number | null
  readinessSnapshot: Record<string, any>
  healthSnapshot: Record<string, any>
  smokeSnapshot: Record<string, any>
  checklistSnapshot: Record<string, any>
  qaSummary: string
  deploymentSummary: string
  rollbackUsed: boolean
  incidentNotes: string
  whatWentWell: string
  whatWentWrong: string
  followUpActions: string
  reviewedBy: number | null
  reviewedAt: string | null
  createdBy: number | null
  createdAt: string | null
  updatedAt: string | null
}

function toNumberOrNull(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function toStringSafe(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function toObjectSafe(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

export function normalizeLaunchRecord(row: any): LaunchRecord {
  return {
    id: Number(row?.id || 0),
    launchName: toStringSafe(row?.launch_name || row?.launchName, 'Untitled launch'),
    launchType: toStringSafe(row?.launch_type || row?.launchType, ''),
    environment: toStringSafe(row?.environment, ''),
    status: toStringSafe(row?.status, 'Completed'),
    linkedIssueIds: Array.isArray(row?.linked_issue_ids || row?.linkedIssueIds)
      ? (row.linked_issue_ids || row.linkedIssueIds).map((item: unknown) => Number(item)).filter((item: number) => Number.isFinite(item))
      : [],
    linkedDeploymentId: toNumberOrNull(row?.linked_deployment_id || row?.linkedDeploymentId),
    linkedMobileReleaseId: toNumberOrNull(row?.linked_mobile_release_id || row?.linkedMobileReleaseId),
    readinessSnapshot: toObjectSafe(row?.readiness_snapshot || row?.readinessSnapshot),
    healthSnapshot: toObjectSafe(row?.health_snapshot || row?.healthSnapshot),
    smokeSnapshot: toObjectSafe(row?.smoke_snapshot || row?.smokeSnapshot),
    checklistSnapshot: toObjectSafe(row?.checklist_snapshot || row?.checklistSnapshot),
    qaSummary: toStringSafe(row?.qa_summary || row?.qaSummary),
    deploymentSummary: toStringSafe(row?.deployment_summary || row?.deploymentSummary),
    rollbackUsed: Boolean(row?.rollback_used ?? row?.rollbackUsed),
    incidentNotes: toStringSafe(row?.incident_notes || row?.incidentNotes),
    whatWentWell: toStringSafe(row?.what_went_well || row?.whatWentWell),
    whatWentWrong: toStringSafe(row?.what_went_wrong || row?.whatWentWrong),
    followUpActions: toStringSafe(row?.follow_up_actions || row?.followUpActions),
    reviewedBy: toNumberOrNull(row?.reviewed_by || row?.reviewedBy),
    reviewedAt: toStringSafe(row?.reviewed_at || row?.reviewedAt, '') || null,
    createdBy: toNumberOrNull(row?.created_by || row?.createdBy),
    createdAt: toStringSafe(row?.created_at || row?.createdAt, '') || null,
    updatedAt: toStringSafe(row?.updated_at || row?.updatedAt, '') || null,
  }
}

export function parseFollowUpActions(text: string) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').replace(/^\[[ xX]\]\s+/, ''))
    .filter(Boolean)
}

export function countFollowUpActions(text: string) {
  return parseFollowUpActions(text).length
}

export function buildPostDeployReviewText(record: LaunchRecord, issueLabels: string[] = []) {
  const issueLine = issueLabels.length ? issueLabels.join(', ') : (record.linkedIssueIds.length ? record.linkedIssueIds.join(', ') : 'None linked')
  return [
    `Launch: ${record.launchName}${record.createdAt ? ` (${record.createdAt})` : ''}`,
    `Environment / Type: ${[record.environment, record.launchType].filter(Boolean).join(' / ') || 'Not specified'}`,
    `Issues included: ${issueLine}`,
    `Health / Smoke: ${record.healthSnapshot?.status || 'Not run'} / ${record.smokeSnapshot?.status || 'Not run'}`,
    `QA summary: ${record.qaSummary || 'Not documented'}`,
    `Deployment summary: ${record.deploymentSummary || 'Not documented'}`,
    `Incident notes: ${record.incidentNotes || 'None'}`,
    `What went well: ${record.whatWentWell || 'Not documented'}`,
    `What went wrong: ${record.whatWentWrong || 'Not documented'}`,
    `Follow-up actions: ${record.followUpActions || 'None'}`,
    `Reviewed by / date: ${record.reviewedBy != null ? `User #${record.reviewedBy}` : 'Not reviewed'}${record.reviewedAt ? ` / ${record.reviewedAt}` : ''}`,
  ].join('\n')
}

export function buildFollowUpActionsText(record: LaunchRecord, issueLabels: string[] = []) {
  const followUps = parseFollowUpActions(record.followUpActions)
  return [
    `Launch Follow-up Actions`,
    `Launch: ${record.launchName}`,
    `Scope: ${issueLabels.length ? issueLabels.join(', ') : (record.linkedIssueIds.length ? record.linkedIssueIds.join(', ') : 'None linked')}`,
    '',
    ...(followUps.length ? followUps.map((item) => `- ${item}`) : ['- No follow-up actions recorded.']),
  ].join('\n')
}
