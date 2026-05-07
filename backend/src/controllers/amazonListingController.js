const { getBudgetSettings } = require('../services/aiBudgetService')
const {
  generateAmazonListings,
  extractListingsPayload,
  saveGeneration,
} = require('../services/amazonListingAiService')
const { generateAndPersistAmazonListing } = require('../services/amazonListingService')
const {
  parseUserIdInt,
  BudgetBlockedError,
  AiGenerationDisabledError,
} = require('../services/aiRequestService')

function normalizeProduct(x) {
  if (!x || typeof x !== 'object') return null
  return x
}

/**
 * POST /api/amazon/generate-listing
 * Requires: validateAiRequest + checkAiBudget middleware
 */
async function postAmazonGenerateListing(req, res) {
  try {
    const result = await generateAndPersistAmazonListing(req.aiListingInput, req.user, {
      budgetPrechecked: true,
      cachedSettings: req.aiBudgetSettings,
    })
    res.json({
      success: true,
      id: result.saved.id,
      created_at: result.saved.created_at,
      title: result.listing.title,
      bullet_points: result.listing.bullet_points,
      description: result.listing.description,
      search_terms: result.listing.search_terms,
      arabic_title: result.listing.arabic_title,
      arabic_bullets: result.listing.arabic_bullets,
      suggested_attributes: result.listing.suggested_attributes,
      meta: result.meta,
    })
  } catch (err) {
    if (err?.code === 'MISSING_API_KEY') {
      return res.status(503).json({
        success: false,
        message: 'AI is not configured (missing OPENAI_API_KEY on the server).',
      })
    }
    if (
      err?.code === 'OPENAI_ERROR' ||
      err?.code === 'OPENAI_TIMEOUT' ||
      err?.code === 'INVALID_AI_JSON'
    ) {
      return res.status(502).json({
        success: false,
        message: err.message || 'Upstream AI error',
      })
    }
    console.error('[amazon generate-listing]', err)
    return res.status(500).json({ success: false, message: 'Failed to generate listing' })
  }
}

/**
 * POST /api/ai/amazon-listing/generate — legacy flexible JSON (product / products[])
 */
async function postLegacyFlexibleGenerate(req, res) {
  try {
    const settings = await getBudgetSettings()
    const maxBatch = settings?.max_batch_size ?? 10

    const single = req.body?.product
    const many = req.body?.products

    let products = []
    if (Array.isArray(many)) {
      products = many.map(normalizeProduct).filter(Boolean)
    } else if (single && typeof single === 'object') {
      products = [single]
    }

    if (products.length === 0) {
      return res.status(400).json({
        error: 'Provide `product` (object) or `products` (non-empty array) with product fields.',
      })
    }
    if (products.length > maxBatch) {
      return res.status(400).json({
        error: `Too many products in one request (${products.length}). Maximum batch size is ${maxBatch} (configure max_batch_size in AI budget settings).`,
      })
    }

    const userIdInt = parseUserIdInt(req.user)
    if (!userIdInt) {
      return res.status(400).json({ error: 'User id missing — cannot attribute AI usage.' })
    }

    const model = req.body?.model || settings?.default_model

    const ai = await generateAmazonListings({
      products,
      reqUser: req.user,
      model,
    })

    const listingResult = extractListingsPayload(ai.data, products.length)

    const saved = await saveGeneration({
      userIdInt,
      productInput: { products },
      listingResult,
      aiUsageLogId: ai.usageLogId,
    })

    res.json({
      id: saved.id,
      created_at: saved.created_at,
      listing: listingResult,
      meta: {
        model: ai.model,
        estimated_cost_usd: ai.estimatedCostUsd,
        usage: ai.usage,
        usage_log_id: ai.usageLogId,
      },
    })
  } catch (err) {
    if (err instanceof BudgetBlockedError) {
      return res.status(403).json({
        success: false,
        message: err.message,
        code: err.code,
        details: err.details,
      })
    }
    if (err instanceof AiGenerationDisabledError) {
      return res.status(403).json({ success: false, message: err.message, code: err.code })
    }
    if (err?.code === 'MISSING_API_KEY') {
      return res.status(503).json({
        success: false,
        message: 'AI is not configured (missing OPENAI_API_KEY on the server).',
        code: err.code,
      })
    }
    if (err?.code === 'OPENAI_ERROR' || err?.code === 'OPENAI_TIMEOUT' || err?.code === 'INVALID_AI_JSON') {
      return res.status(502).json({
        success: false,
        message: err.message || 'Upstream AI error',
        code: err.code,
      })
    }
    console.error('[amazon-listing legacy]', err)
    return res.status(500).json({ error: 'Failed to generate listing' })
  }
}

module.exports = {
  postAmazonGenerateListing,
  postLegacyFlexibleGenerate,
}
