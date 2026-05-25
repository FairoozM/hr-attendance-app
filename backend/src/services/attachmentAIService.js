/**
 * AI vision analysis for image attachments.
 *
 * Uses getObjectBuffer to fetch the image from S3 server-side, converts it to
 * a base64 data URL, and sends it to a vision-capable OpenAI model.
 * The API key and S3 credentials never reach the frontend.
 */
const { query } = require('../db')
const s3Service = require('./s3Service')
const { runOpenAiJsonChat } = require('./aiRequestService')

// Models that support vision content
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o'

// Only analyze these MIME types
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
])

// Hard cap: 5 MB to keep latency reasonable
const MAX_BYTES_FOR_AI = 5 * 1024 * 1024

const SYSTEM_PROMPT = `\
You are a senior product engineer and UX/UI expert for Life Smile — a company building:
- lifesmile.ae (e-commerce website)
- Android mobile app
- iOS mobile app
- Backend/API services
- UX/UI design
- Data & BI

Analyze the provided screenshot and return a thorough JSON object with these exact keys:
{
  "summary": "One concise sentence describing what the screenshot shows and the primary issue or observation.",
  "observations": ["Observation 1", "Observation 2", "..."],
  "suggestedIssueDescription": "A clear, developer-friendly issue description (2–4 sentences) suitable for a Linear issue.",
  "acceptanceCriteria": ["Criterion 1", "Criterion 2", "..."],
  "qaChecklist": ["Test step 1", "Test step 2", "..."],
  "cursorPrompt": "A detailed Cursor AI implementation prompt based on what is visible in the screenshot."
}

Focus on:
- Visible UI/UX issues
- Layout or spacing problems
- Mobile responsiveness
- Missing or incorrect states (loading, empty, error)
- Readability and typography
- Checkout, product listing, search, or payment flows if visible
- Suggested fixes with enough detail for a developer to act on

Important rules:
- Do NOT identify real people. If people appear, describe only the surrounding UI context.
- Return valid JSON only, no markdown fences.
- Provide at least 3 observations, 3 acceptance criteria, and 3 QA checklist items.`

/**
 * Analyzes an image attachment via OpenAI vision.
 *
 * @param {{ projectId: number, taskId: number, attachmentId: number, reqUser: object|null }} opts
 * @returns {Promise<{ summary, observations, suggestedIssueDescription, acceptanceCriteria, qaChecklist, cursorPrompt }>}
 */
async function analyzeAttachment({ projectId, taskId, attachmentId, reqUser }) {
  // 1. Fetch attachment row and verify it belongs to this task/project
  const attResult = await query(
    `SELECT ta.id, ta.file_name, ta.file_type, ta.file_size, ta.s3_key
       FROM task_attachments ta
       JOIN project_tasks pt ON pt.id = ta.task_id
      WHERE ta.id = $1
        AND ta.task_id = $2
        AND pt.project_id = $3`,
    [attachmentId, taskId, projectId]
  )
  if (!attResult.rows.length) {
    const err = new Error('Attachment not found.')
    err.code = 'NOT_FOUND'
    throw err
  }
  const att = attResult.rows[0]

  // 2. Check file type
  if (!SUPPORTED_IMAGE_TYPES.has(att.file_type)) {
    const err = new Error('AI image analysis is not supported for this file type.')
    err.code = 'UNSUPPORTED_TYPE'
    throw err
  }

  // 3. Check file_size metadata (fast fail before fetching from S3)
  if (att.file_size && att.file_size > MAX_BYTES_FOR_AI) {
    const err = new Error(`Image is too large for AI analysis (max 5 MB). This file is ${(att.file_size / 1024 / 1024).toFixed(1)} MB.`)
    err.code = 'FILE_TOO_LARGE'
    throw err
  }

  // 4. Fetch image buffer from S3
  let buf
  try {
    buf = await s3Service.getObjectBuffer({ key: att.s3_key })
  } catch (s3Err) {
    const err = new Error('Could not retrieve image from storage.')
    err.code = 'S3_FETCH_FAILED'
    err.cause = s3Err
    throw err
  }
  if (!buf || buf.length === 0) {
    const err = new Error('Image file is empty or could not be retrieved.')
    err.code = 'S3_FETCH_FAILED'
    throw err
  }

  // Double-check buffer size (covers cases where file_size was not stored)
  if (buf.length > MAX_BYTES_FOR_AI) {
    const err = new Error(`Image is too large for AI analysis (max 5 MB). This file is ${(buf.length / 1024 / 1024).toFixed(1)} MB.`)
    err.code = 'FILE_TOO_LARGE'
    throw err
  }

  // 5. Build base64 data URL for OpenAI vision
  const b64 = buf.toString('base64')
  const dataUrl = `data:${att.file_type};base64,${b64}`

  // 6. Call AI with vision-capable model
  const result = await runOpenAiJsonChat({
    reqUser: reqUser || null,
    moduleName: 'attachment_ai',
    actionName: 'analyze_screenshot',
    model: VISION_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'high' },
          },
          {
            type: 'text',
            text: 'Please analyze this screenshot and return the JSON object as described.',
          },
        ],
      },
    ],
    temperature: 0.3,
    timeoutMs: 90_000,
    maxRetries: 1,
    budgetPrechecked: false,
  })

  const d = result.data || {}
  return {
    summary:                   String(d.summary || ''),
    observations:              Array.isArray(d.observations) ? d.observations.map(String) : [],
    suggestedIssueDescription: String(d.suggestedIssueDescription || ''),
    acceptanceCriteria:        Array.isArray(d.acceptanceCriteria) ? d.acceptanceCriteria.map(String) : [],
    qaChecklist:               Array.isArray(d.qaChecklist) ? d.qaChecklist.map(String) : [],
    cursorPrompt:              String(d.cursorPrompt || ''),
  }
}

module.exports = { analyzeAttachment }
