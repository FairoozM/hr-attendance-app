/**
 * issueAIService.js
 * Builds prompts for Issue AI Assistant actions and calls runOpenAiJsonChat.
 * Actions: improve_title, draft_description, acceptance_criteria,
 *           qa_checklist, cursor_prompt, release_note
 */
'use strict'

const { runOpenAiJsonChat } = require('./aiRequestService')

const LIFE_SMILE_CONTEXT =
  'This is for Life Smile — a product/development team building: ' +
  'lifesmile.ae (e-commerce website), Android app, iOS app, Backend/API, UX/UI Design, and Data & BI.'

// Map project name → team label
function inferTeam(projectName = '') {
  const n = (projectName || '').toLowerCase()
  if (n.includes('android'))                                         return 'Android App'
  if (n.includes('ios') || n.includes('iphone'))                    return 'iOS App'
  if (n.includes('ux') || n.includes('ui') || n.includes('design')) return 'UX/UI Design'
  if (n.includes('backend') || n.includes('api') || n.includes('server')) return 'Backend/API'
  if (n.includes('data') || n.includes('bi') || n.includes('analytics')) return 'Data & BI'
  return 'Website'
}

/**
 * @param {object} issue   – issue row from DB (camelCase normalised)
 * @param {object} project – project row
 * @param {string} action  – one of the 6 AI actions
 * @param {string} [extraContext] – optional extra context from the user
 * @param {object} reqUser – for budget logging
 * @param {object} [cachedSettings]
 */
async function runIssueAIAction({ issue, project, action, extraContext, reqUser, cachedSettings }) {
  const team   = inferTeam(project?.name)
  const title  = issue.title        || '(no title)'
  const desc   = issue.description  || '(no description)'
  const type   = issue.issue_type   || issue.issueType || 'feature'
  const prio   = issue.priority     || 'medium'
  const status = issue.status       || 'todo'
  const labels = Array.isArray(issue.labels) ? issue.labels.join(', ') : ''
  const blocked= issue.blocked_reason || issue.blockedReason || ''
  const extra  = extraContext ? `\n\nAdditional context from user: ${extraContext}` : ''

  const base = `${LIFE_SMILE_CONTEXT}\n\nIssue info:\n- Team: ${team}\n- Type: ${type}\n- Priority: ${prio}\n- Status: ${status}\n- Labels: ${labels || 'none'}${blocked ? `\n- Blocked reason: ${blocked}` : ''}${extra}`

  let systemPrompt, userPrompt, actionName

  switch (action) {
    case 'improve_title':
      actionName  = 'improve_title'
      systemPrompt = 'You are a product manager writing concise, clear, actionable issue titles for a dev team.'
      userPrompt   = `${base}\n\nCurrent title: "${title}"\n\nReturn JSON: { "output": "option1\\noption2\\noption3" } — exactly 3 improved title options, one per line, no numbering.`
      break

    case 'draft_description':
      actionName  = 'draft_description'
      systemPrompt = 'You are a senior product manager writing structured issue descriptions for engineers.'
      userPrompt   = `${base}\n\nTitle: "${title}"\nCurrent description: "${desc}"\n\nReturn JSON: { "output": "..." } with a description containing these sections:\n**Context**\n(background)\n\n**Problem**\n(what is wrong or needed)\n\n**Expected Outcome**\n(what done looks like)\n\n**Notes**\n(edge cases, dependencies, links)`
      break

    case 'acceptance_criteria':
      actionName  = 'acceptance_criteria'
      systemPrompt = 'You are a product manager writing acceptance criteria as a concise checklist.'
      userPrompt   = `${base}\n\nTitle: "${title}"\nDescription: "${desc}"\n\nReturn JSON: { "output": "..." } with 4-8 acceptance criteria in GitHub checkbox format:\n- [ ] criterion\n(no extra explanation)`
      break

    case 'qa_checklist':
      actionName  = 'qa_checklist'
      systemPrompt = 'You are a QA engineer writing a testing checklist tailored to the specific team and issue.'
      userPrompt   = `${base}\n\nTitle: "${title}"\nDescription: "${desc}"\n\nReturn JSON: { "output": "..." } with a QA testing checklist in checkbox format. Include platform-specific steps for team "${team}". Typical: desktop, mobile, auth states, error states, edge cases.`
      break

    case 'cursor_prompt':
      actionName  = 'cursor_prompt'
      systemPrompt = 'You are a senior engineer writing precise Cursor AI implementation prompts for a React/Node.js codebase.'
      userPrompt   = `${base}\n\nTitle: "${title}"\nDescription: "${desc}"\n\nReturn JSON: { "output": "..." } with a detailed Cursor implementation prompt that includes:\n- Context (what, why, team)\n- Specific task steps\n- File/component names if inferable\n- Expected behavior\n- Safety rules (no unrelated refactors, no breaking changes, no DB migrations unless explicitly needed)\n- Testing checklist\nKeep it actionable and concise.`
      break

    case 'release_note':
      actionName  = 'release_note'
      systemPrompt = 'You are a product manager writing brief, clear internal release notes.'
      userPrompt   = `${base}\n\nTitle: "${title}"\nDescription: "${desc}"\n\nReturn JSON: { "output": "..." } with a short internal release note (3-5 sentences) covering:\n- What changed\n- Who it affects\n- Testing note`
      break

    default:
      throw Object.assign(new Error(`Unknown action: ${action}`), { code: 'UNKNOWN_ACTION' })
  }

  const result = await runOpenAiJsonChat({
    reqUser,
    cachedSettings,
    moduleName: 'linear_issue_ai',
    actionName,
    budgetPrechecked: false,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   },
    ],
    temperature: 0.4,
    timeoutMs: 60_000,
    maxRetries: 1,
  })

  const output = result.data?.output
  if (typeof output !== 'string') {
    throw Object.assign(new Error('AI returned unexpected format'), { code: 'INVALID_AI_RESPONSE' })
  }

  return { action, output: output.trim() }
}

module.exports = { runIssueAIAction }
