const { runOpenAiJsonChat } = require('./aiRequestService')
const { query } = require('../db')

const SYSTEM_PROMPT = `You are an expert Amazon marketplace copywriter for English and Arabic Gulf-region shoppers.
You receive product data as JSON. Produce compliant, concise listing copy — no medical claims unless clearly supported by input.

Return ONE JSON object with this exact shape:
{
  "listings": [
    {
      "title": string (<= 200 chars),
      "bullet_points": string[] (exactly 5 short bullets),
      "description": string (multi-paragraph plain text),
      "search_terms": string (space-separated relevant keywords, no commas),
      "arabic_title": string,
      "arabic_bullets": string[] (exactly 5),
      "suggested_attributes": object (key/value strings for Amazon attributes e.g. material, color, size_map)
    }
  ]
}

There must be exactly one entry in "listings" per product object supplied (same order).
Use only information present in the product data; if unknown, omit or use neutral wording.
JSON only — no markdown.`

function buildUserContent(products) {
  return JSON.stringify({ products }, null, 2)
}

/**
 * @param {object} opts
 * @param {object[]} opts.products
 * @param {object|null} opts.reqUser
 * @param {string} opts.model
 */
async function generateAmazonListings({ products, reqUser, model }) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Product rows:\n' +
        buildUserContent(products) +
        '\nRespond with JSON only matching the schema.',
    },
  ]

  return runOpenAiJsonChat({
    reqUser,
    moduleName: 'amazon_listing',
    actionName: 'generate_listing',
    model,
    messages,
    temperature: 0.25,
  })
}

function normalizeListingEntry(entry, index) {
  const bullets = Array.isArray(entry?.bullet_points) ? entry.bullet_points.map(String) : []
  const arabicBullets = Array.isArray(entry?.arabic_bullets) ? entry.arabic_bullets.map(String) : []
  const attrs =
    entry?.suggested_attributes && typeof entry.suggested_attributes === 'object' && !Array.isArray(entry.suggested_attributes)
      ? entry.suggested_attributes
      : {}
  return {
    title: String(entry?.title || `Product ${index + 1}`),
    bullet_points: bullets.slice(0, 5),
    description: String(entry?.description || ''),
    search_terms: String(entry?.search_terms || ''),
    arabic_title: String(entry?.arabic_title || ''),
    arabic_bullets: arabicBullets.slice(0, 5),
    suggested_attributes: attrs,
  }
}

/**
 * Validates AI JSON and aligns listing count with products.
 */
function extractListingsPayload(aiJson, productsLength) {
  const rawListings = Array.isArray(aiJson?.listings) ? aiJson.listings : []
  const listings = []
  for (let i = 0; i < productsLength; i++) {
    listings.push(normalizeListingEntry(rawListings[i], i))
  }
  return { listings }
}

async function saveGeneration({ userIdInt, productInput, listingResult, aiUsageLogId }) {
  const r = await query(
    `INSERT INTO amazon_listing_generations (user_id, product_input, listing_result, ai_usage_log_id)
     VALUES ($1, $2::jsonb, $3::jsonb, $4)
     RETURNING id, created_at`,
    [userIdInt, JSON.stringify(productInput), JSON.stringify(listingResult), aiUsageLogId]
  )
  return r.rows[0]
}

module.exports = {
  generateAmazonListings,
  extractListingsPayload,
  saveGeneration,
  SYSTEM_PROMPT,
}
