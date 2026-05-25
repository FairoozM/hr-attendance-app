/**
 * weeklyReportAIService.js
 * Builds prompts and calls runOpenAiJsonChat for the five weekly-report AI actions.
 *
 * Actions:
 *   executive_summary | decision_brief | blockers_summary | release_plan | whatsapp_update
 *
 * All return { output: string }.
 */
'use strict'

const { runOpenAiJsonChat } = require('./aiRequestService')

const LIFE_SMILE_CONTEXT =
  'This is for Life Smile — a product/development team building: ' +
  'lifesmile.ae (e-commerce website), an Android app, an iOS app, ' +
  'a Backend/API, UX/UI design work, and Data & BI. ' +
  'Use "Issue" not "Task", "Cycle" not "Sprint". ' +
  'Do not use Jira wording.'

const SHARED_SYSTEM_PROMPT =
  `You are a senior product manager and engineering leader for Life Smile. ` +
  LIFE_SMILE_CONTEXT +
  ` Respond with a single JSON object that has exactly one key: "output" whose value is a ` +
  `clean, well-formatted string. Use plain text with line breaks, not HTML. ` +
  `Use minimal markdown (bold **word**, bullet • ) that renders well in both email and WhatsApp.`

// ── Prompt builders ────────────────────────────────────────────────────────────

function buildExecutiveSummaryPrompt(data) {
  return [
    {
      role: 'system',
      content: SHARED_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `Generate a concise executive summary for the week of ${data.dateRange || 'this week'}.\n\n` +
        `Write 3–5 short paragraphs covering:\n` +
        `1. What moved forward this week (completed issues, progress)\n` +
        `2. What is ready for release / QA approved\n` +
        `3. What is blocked or at risk\n` +
        `4. Recommended next actions for the team\n\n` +
        `Be direct, factual, and management-ready. No filler.\n\n` +
        `Report data:\n${JSON.stringify(data, null, 2)}`,
    },
  ]
}

function buildDecisionBriefPrompt(data) {
  return [
    {
      role: 'system',
      content: SHARED_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `Generate a decision brief for Abdullah (Life Smile product owner) for the week of ${data.dateRange || 'this week'}.\n\n` +
        `List 3–6 decisions that need to be made this week. For each decision:\n` +
        `• Issue / Area: (which issue or project area)\n` +
        `• Decision needed: (what must be decided)\n` +
        `• Why it matters: (business or delivery impact)\n` +
        `• Recommended action: (your recommendation)\n\n` +
        `Focus on the most impactful items. If there are no decisions needed, say so clearly.\n\n` +
        `Report data:\n${JSON.stringify(data, null, 2)}`,
    },
  ]
}

function buildBlockersSummaryPrompt(data) {
  return [
    {
      role: 'system',
      content: SHARED_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `Summarize all blockers and overdue work for the week of ${data.dateRange || 'this week'}.\n\n` +
        `For each blocker or overdue issue:\n` +
        `• Issue: (title and key)\n` +
        `• Owner: (assignee or unassigned)\n` +
        `• Impact: (what is delayed or affected)\n` +
        `• Recommended next step: (concrete action)\n\n` +
        `Then provide a 1-paragraph overall risk assessment.\n` +
        `If there are no blockers, say so clearly.\n\n` +
        `Report data:\n${JSON.stringify(data, null, 2)}`,
    },
  ]
}

function buildReleasePlanPrompt(data) {
  return [
    {
      role: 'system',
      content: SHARED_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `Summarize the release plan for the week of ${data.dateRange || 'this week'}.\n\n` +
        `Cover:\n` +
        `1. Issues ready for release and their QA/approval status\n` +
        `2. Upcoming mobile app releases (Android / iOS)\n` +
        `3. Upcoming website and backend deployments\n` +
        `4. Recommended release order and any risks\n` +
        `5. Any pre-release actions still needed\n\n` +
        `Keep it concise and actionable.\n\n` +
        `Report data:\n${JSON.stringify(data, null, 2)}`,
    },
  ]
}

function buildWhatsAppUpdatePrompt(data) {
  return [
    {
      role: 'system',
      content: SHARED_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `Write a short, friendly WhatsApp update for the Life Smile dev team for the week of ${data.dateRange || 'this week'}.\n\n` +
        `Requirements:\n` +
        `• Maximum 200 words\n` +
        `• Conversational but professional tone\n` +
        `• Use emojis sparingly (✅ 🚀 ⚠️ 🔄 only)\n` +
        `• Cover: progress this week, what's ready to ship, any blockers, next actions\n` +
        `• End with one clear "next step" for the team\n` +
        `• No markdown headers — just short paragraphs or bullets\n\n` +
        `Report data:\n${JSON.stringify(data, null, 2)}`,
    },
  ]
}

// ── Main function ─────────────────────────────────────────────────────────────

const PROMPT_BUILDERS = {
  executive_summary: buildExecutiveSummaryPrompt,
  decision_brief:    buildDecisionBriefPrompt,
  blockers_summary:  buildBlockersSummaryPrompt,
  release_plan:      buildReleasePlanPrompt,
  whatsapp_update:   buildWhatsAppUpdatePrompt,
}

const VALID_ACTIONS = Object.keys(PROMPT_BUILDERS)

/**
 * Generate an AI weekly report summary for the given action.
 *
 * @param {{ action: string, reportData: object, reqUser: object, cachedSettings?: object }} opts
 * @returns {Promise<{ output: string }>}
 */
async function generateWeeklyReportSummary({ action, reportData, reqUser, cachedSettings }) {
  if (!VALID_ACTIONS.includes(action)) {
    const err = new Error(`Unknown action: ${action}. Valid: ${VALID_ACTIONS.join(', ')}`)
    err.code = 'UNKNOWN_ACTION'
    throw err
  }

  const buildPrompt = PROMPT_BUILDERS[action]
  const messages    = buildPrompt(reportData)

  // Trim the report data to avoid excessive token usage — keep only summaries
  const result = await runOpenAiJsonChat({
    reqUser,
    cachedSettings,
    moduleName: 'linear_weekly_report',
    actionName: action,
    messages,
    temperature: 0.35,
    timeoutMs: 60_000,
    maxRetries: 1,
  })

  // result.data is the parsed JSON object returned by the model
  const parsed = result.data
  const output = typeof parsed?.output === 'string' ? parsed.output.trim() : JSON.stringify(parsed)

  if (!output) {
    throw Object.assign(new Error('AI returned empty output'), { code: 'EMPTY_RESPONSE' })
  }

  return { output }
}

module.exports = { generateWeeklyReportSummary, VALID_ACTIONS }
