'use strict'

const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { callAmazonSpApi, getAmazonConfig, getAmazonSpApiMode } = require('../amazonSpApiService')
const { sanitizeUrl, redactDefinitionLinks } = require('./urlSanitize')
const { extractSchemaSummary } = require('./schemaParser')
const { classifyKitchenProductType } = require('./kitchenClassifier')
const { writeKitchenExtractionWorkbook } = require('./workbookBuilder')

const MARKETPLACE_ID = 'A2VIGQ35RCS4UG'
const LOCALE = 'en_AE'
const PRODUCT_TYPES_PATH = '/definitions/2020-09-01/productTypes'
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '../../../data/amazon-uae-kitchen-catalogue')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeErrorFromData(data) {
  if (!data || typeof data !== 'object') return null
  if (Array.isArray(data.errors) && data.errors[0]) {
    const e = data.errors[0]
    const code = e.code != null ? String(e.code) : ''
    const message = e.message != null ? String(e.message).slice(0, 400) : ''
    return [code, message].filter(Boolean).join(': ') || null
  }
  return null
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function definitionCachePath(definitionsDir, productType) {
  const safe = String(productType).replace(/[^A-Za-z0-9._-]+/g, '_')
  return path.join(definitionsDir, `${safe}.json`)
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/**
 * Retry wrapper for 429 and temporary 5xx (and network errors).
 * @template T
 * @param {() => Promise<{ ok: boolean, retryable: boolean, status?: number, value?: T, error?: string }>} attemptFn
 * @param {{ maxAttempts?: number, label?: string }} [opts]
 */
async function withBackoffRetries(attemptFn, opts = {}) {
  const maxAttempts = Math.max(1, opts.maxAttempts || 6)
  let last = { ok: false, retryable: false, status: 0, error: 'no_attempt' }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await attemptFn(attempt)
    last = { ...result, attemptCount: attempt }
    if (result.ok) return last
    if (!result.retryable || attempt === maxAttempts) return last
    const base = Math.min(60_000, 1000 * 2 ** (attempt - 1))
    const jitter = Math.floor(Math.random() * 400)
    // eslint-disable-next-line no-await-in-loop
    await sleep(base + jitter)
  }
  return last
}

async function searchAllProductTypes() {
  const result = await withBackoffRetries(async () => {
    const res = await callAmazonSpApi(PRODUCT_TYPES_PATH, {
      marketplaceKey: 'uae',
      method: 'GET',
      params: {
        marketplaceIds: MARKETPLACE_ID,
        locale: LOCALE,
      },
      paramsSerializer: { indexes: null },
      amazonOperation: 'searchDefinitionsProductTypes',
    })
    const status = res.status
    if (status >= 200 && status < 300 && res.data && Array.isArray(res.data.productTypes)) {
      return { ok: true, retryable: false, status, value: res.data }
    }
    const retryable = status === 429 || status >= 500
    return {
      ok: false,
      retryable,
      status,
      error: safeErrorFromData(res.data) || `HTTP ${status}`,
    }
  })

  if (!result.ok) {
    const err = new Error(result.error || 'searchDefinitionsProductTypes failed')
    err.code = 'AMAZON_PRODUCT_TYPES_SEARCH_FAILED'
    err.httpStatus = result.status
    throw err
  }
  return result.value
}

async function getProductTypeDefinition(productType) {
  const apiPath = `${PRODUCT_TYPES_PATH}/${encodeURIComponent(productType)}`
  return withBackoffRetries(async () => {
    const res = await callAmazonSpApi(apiPath, {
      marketplaceKey: 'uae',
      method: 'GET',
      params: {
        marketplaceIds: MARKETPLACE_ID,
        requirements: 'LISTING',
        locale: LOCALE,
        productTypeVersion: 'LATEST',
      },
      paramsSerializer: { indexes: null },
      amazonOperation: 'getDefinitionsProductType',
    })
    const status = res.status
    if (status >= 200 && status < 300 && res.data && typeof res.data === 'object') {
      return { ok: true, retryable: false, status, value: res.data }
    }
    const retryable = status === 429 || status >= 500
    return {
      ok: false,
      retryable,
      status,
      error: safeErrorFromData(res.data) || `HTTP ${status}`,
      request: `GET ${apiPath}`,
    }
  })
}

async function downloadSchema(schemaResourceUrl) {
  const url = String(schemaResourceUrl || '').trim()
  if (!url) {
    return { ok: false, retryable: false, status: 0, error: 'Missing schema link resource', request: 'schema_download' }
  }
  return withBackoffRetries(async () => {
    try {
      const res = await axios.get(url, {
        timeout: 90_000,
        validateStatus: () => true,
        responseType: 'json',
        // Do not attach SP-API tokens; schema links are pre-signed S3 URLs.
        headers: { accept: 'application/json' },
      })
      const status = res.status
      if (status >= 200 && status < 300 && res.data && typeof res.data === 'object') {
        return {
          ok: true,
          retryable: false,
          status,
          value: res.data,
          request: `GET ${sanitizeUrl(url)}`,
        }
      }
      const retryable = status === 429 || status >= 500
      return {
        ok: false,
        retryable,
        status,
        error: `Schema HTTP ${status}`,
        request: `GET ${sanitizeUrl(url)}`,
      }
    } catch (e) {
      return {
        ok: false,
        retryable: true,
        status: 0,
        error: e && e.message ? String(e.message).slice(0, 400) : 'schema_download_error',
        request: `GET ${sanitizeUrl(url)}`,
      }
    }
  })
}

/**
 * @param {object} cached
 */
function isSuccessfulCache(cached) {
  return (
    cached &&
    cached.retrievalStatus === 'success' &&
    cached.definition &&
    typeof cached.definition === 'object' &&
    cached.schema &&
    typeof cached.schema === 'object'
  )
}

/**
 * @param {string} productType
 * @param {string} definitionsDir
 * @param {Array<object>} failedRows
 */
async function loadOrFetchDefinition(productType, definitionsDir, failedRows) {
  const cacheFile = definitionCachePath(definitionsDir, productType)
  const cached = readJsonIfExists(cacheFile)
  if (isSuccessfulCache(cached)) {
    return { ...cached, fromCache: true }
  }

  const defResult = await getProductTypeDefinition(productType)
  if (!defResult.ok) {
    const row = {
      productType,
      retrievalStatus: 'failed',
      retrievedAt: new Date().toISOString(),
      attemptCount: defResult.attemptCount || 1,
      error: defResult.error || 'definition_failed',
      httpStatus: defResult.status || 0,
      request: defResult.request || `GET ${PRODUCT_TYPES_PATH}/${productType}`,
      definition: null,
      schema: null,
      schemaUrl: '',
      fromCache: false,
    }
    writeJson(cacheFile, row)
    failedRows.push({
      productType,
      request: row.request,
      httpStatus: row.httpStatus,
      attemptCount: row.attemptCount,
      error: row.error,
      lastAttempt: row.retrievedAt,
    })
    return row
  }

  const definition = defResult.value
  const schemaResource =
    definition &&
    definition.schema &&
    definition.schema.link &&
    definition.schema.link.resource
      ? String(definition.schema.link.resource)
      : ''

  const schemaResult = await downloadSchema(schemaResource)
  if (!schemaResult.ok) {
    const row = {
      productType,
      retrievalStatus: 'failed',
      retrievedAt: new Date().toISOString(),
      attemptCount: (defResult.attemptCount || 1) + (schemaResult.attemptCount || 1),
      error: schemaResult.error || 'schema_failed',
      httpStatus: schemaResult.status || 0,
      request: schemaResult.request || `GET ${sanitizeUrl(schemaResource)}`,
      definition: redactDefinitionLinks(definition),
      schema: null,
      schemaUrl: sanitizeUrl(schemaResource),
      fromCache: false,
    }
    writeJson(cacheFile, row)
    failedRows.push({
      productType,
      request: row.request,
      httpStatus: row.httpStatus,
      attemptCount: row.attemptCount,
      error: row.error,
      lastAttempt: row.retrievedAt,
    })
    return row
  }

  const row = {
    productType,
    retrievalStatus: 'success',
    retrievedAt: new Date().toISOString(),
    attemptCount: (defResult.attemptCount || 1) + (schemaResult.attemptCount || 1),
    error: '',
    httpStatus: 200,
    request: `GET ${PRODUCT_TYPES_PATH}/${productType}`,
    definition: redactDefinitionLinks(definition),
    schema: schemaResult.value,
    schemaUrl: sanitizeUrl(schemaResource),
    schemaChecksum:
      definition && definition.schema && definition.schema.checksum != null
        ? String(definition.schema.checksum)
        : '',
    fromCache: false,
  }
  writeJson(cacheFile, row)
  return row
}

function joinList(values) {
  return (values || []).map((v) => String(v)).join(' | ')
}

/**
 * @param {object} [options]
 */
async function runAmazonUaeKitchenExtraction(options = {}) {
  const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT_DIR)
  const definitionsDir = path.join(outputDir, 'amazon_uae_product_type_definitions')
  const allTypesPath = path.join(outputDir, 'amazon_uae_all_product_types.json')
  const workbookPath = path.join(outputDir, 'amazon_uae_kitchen_product_types.xlsx')
  const summaryPath = path.join(outputDir, 'amazon_uae_kitchen_extraction_summary.json')
  const progressEvery = Number(options.progressEvery || 25)

  ensureDir(outputDir)
  ensureDir(definitionsDir)

  const cfg = getAmazonConfig('uae')
  const mode = getAmazonSpApiMode()
  console.log(`[amazon-uae-kitchen] mode=${mode} marketplace=${MARKETPLACE_ID} locale=${LOCALE}`)
  console.log(`[amazon-uae-kitchen] output=${outputDir}`)
  console.log('[amazon-uae-kitchen] Step 2: searchDefinitionsProductTypes (no keywords)')

  const listPayload = await searchAllProductTypes()
  const productTypes = Array.isArray(listPayload.productTypes) ? listPayload.productTypes : []
  const names = productTypes.map((pt) => String(pt && pt.name != null ? pt.name : '').trim()).filter(Boolean)
  const uniqueNames = [...new Set(names)]
  if (uniqueNames.length !== names.length) {
    console.warn(
      `[amazon-uae-kitchen] WARNING: duplicate product type codes in API response (${names.length} rows, ${uniqueNames.length} unique)`
    )
  }

  writeJson(allTypesPath, {
    retrievedAt: new Date().toISOString(),
    marketplaceId: MARKETPLACE_ID,
    locale: LOCALE,
    keywordsUsed: false,
    productTypeVersion: listPayload.productTypeVersion || null,
    productTypes,
  })
  console.log(`[amazon-uae-kitchen] Saved ${productTypes.length} product types → ${allTypesPath}`)

  const failedRows = []
  const records = []
  let fetched = 0
  let cached = 0
  let failed = 0

  console.log(`[amazon-uae-kitchen] Step 3: fetching definitions for ${productTypes.length} types`)
  for (let i = 0; i < productTypes.length; i += 1) {
    const pt = productTypes[i] || {}
    const name = String(pt.name || '').trim()
    const displayName = String(pt.displayName != null ? pt.displayName : name).trim()
    if (!name) continue

    // eslint-disable-next-line no-await-in-loop
    const loaded = await loadOrFetchDefinition(name, definitionsDir, failedRows)
    if (loaded.fromCache) cached += 1
    else if (loaded.retrievalStatus === 'success') fetched += 1
    else failed += 1

    let schemaSummary = {
      requiredAttributes: [],
      conditionallyRequiredAttributes: [],
      requiredAttributeDetails: [],
      conditionalAttributeDetails: [],
      variationSupported: false,
      parentSupported: false,
      childSupported: false,
      variationThemes: [],
      itemTypeKeywords: [],
      recommendedBrowseNodeIds: [],
      recommendedBrowseNodeLabels: [],
      schemaVersion: '',
      propertyGroups: [],
    }
    if (loaded.retrievalStatus === 'success') {
      schemaSummary = extractSchemaSummary(loaded.schema, loaded.definition)
    }

    const classification = classifyKitchenProductType({
      name,
      displayName: (loaded.definition && loaded.definition.displayName) || displayName,
      browseNodeLabels: schemaSummary.recommendedBrowseNodeLabels,
      itemTypeKeywords: schemaSummary.itemTypeKeywords,
      propertyGroups: schemaSummary.propertyGroups,
    })

    records.push({
      name,
      displayName: (loaded.definition && loaded.definition.displayName) || displayName,
      marketplaceIds: pt.marketplaceIds || [MARKETPLACE_ID],
      listMeta: pt,
      loaded,
      schemaSummary,
      classification,
    })

    if ((i + 1) % progressEvery === 0 || i + 1 === productTypes.length) {
      console.log(
        `[amazon-uae-kitchen] progress ${i + 1}/${productTypes.length} (fetched=${fetched}, cache=${cached}, failed=${failed})`
      )
    }
  }

  const kitchenRecords = records.filter((r) => r.classification.is_kitchen)
  const successfulDefinitions = records.filter((r) => r.loaded.retrievalStatus === 'success').length
  const failedDefinitions = records.filter((r) => r.loaded.retrievalStatus !== 'success').length
  const exactClassifications = kitchenRecords.filter((r) => r.classification.confidence === 'exact').length
  const inferredClassifications = kitchenRecords.filter((r) =>
    ['high', 'medium', 'low'].includes(r.classification.confidence)
  ).length

  const kitchenRows = kitchenRecords.map((r) => ({
    productType: r.name,
    displayName: r.displayName,
    kitchenSection: r.classification.kitchen_section,
    confidence: r.classification.confidence,
    classificationSource: r.classification.classification_source,
    classificationReason: r.classification.classification_reason,
    requiredAttributeCount: r.schemaSummary.requiredAttributes.length,
    variationSupported: r.schemaSummary.variationSupported ? 'Yes' : 'No',
    variationThemes: joinList(r.schemaSummary.variationThemes),
    itemTypeKeywords: joinList(r.schemaSummary.itemTypeKeywords),
    recommendedBrowseNodes: joinList(r.schemaSummary.recommendedBrowseNodeLabels),
    schemaVersion: r.schemaSummary.schemaVersion,
    retrievalStatus: r.loaded.retrievalStatus,
    retrievedAt: r.loaded.retrievedAt || '',
    error: r.loaded.error || '',
  }))

  const allRows = records.map((r) => ({
    productType: r.name,
    displayName: r.displayName,
    isKitchen: r.classification.is_kitchen ? 'Yes' : 'No',
    kitchenSection: r.classification.kitchen_section,
    confidence: r.classification.confidence,
    classificationSource: r.classification.classification_source,
    classificationReason: r.classification.classification_reason,
    definitionStatus: r.loaded.retrievalStatus,
  }))

  const attributeRows = []
  const variationRows = []
  for (const r of kitchenRecords) {
    for (const attr of [
      ...r.schemaSummary.requiredAttributeDetails,
      ...r.schemaSummary.conditionalAttributeDetails,
    ]) {
      attributeRows.push({
        productType: r.name,
        displayName: r.displayName,
        attributeName: attr.name,
        attributeDisplayName: attr.displayName,
        requirementType: attr.requirementType,
        dataType: attr.dataType,
        allowedValues: attr.allowedValues,
        unitValues: attr.unitValues,
        attributeDescription: attr.description,
      })
    }
    if (r.schemaSummary.variationThemes.length) {
      for (const theme of r.schemaSummary.variationThemes) {
        variationRows.push({
          productType: r.name,
          displayName: r.displayName,
          variationTheme: theme,
          parentSupported: r.schemaSummary.parentSupported ? 'Yes' : 'No',
          childSupported: r.schemaSummary.childSupported ? 'Yes' : 'No',
        })
      }
    } else if (r.schemaSummary.variationSupported) {
      variationRows.push({
        productType: r.name,
        displayName: r.displayName,
        variationTheme: '(supported; no theme enum extracted)',
        parentSupported: r.schemaSummary.parentSupported ? 'Yes' : 'No',
        childSupported: r.schemaSummary.childSupported ? 'Yes' : 'No',
      })
    }
  }

  const methodology = {
    marketplace: 'Amazon UAE',
    marketplaceId: MARKETPLACE_ID,
    endpointRegion: 'Europe',
    baseUrl: sanitizeUrl(cfg.endpoint) || 'https://sellingpartnerapi-eu.amazon.com',
    locale: LOCALE,
    extractionDate: new Date().toISOString(),
    apiOperations: 'searchDefinitionsProductTypes; getDefinitionsProductType; schema link download',
    keywordsUsed: 'No — marketplaceIds + locale only',
    totalUaeProductTypes: productTypes.length,
    kitchenCount: kitchenRecords.length,
    successfulDefinitions,
    failedDefinitions,
    exactClassifications,
    inferredClassifications,
    officialMappingAvailable:
      'No. Product Type Definitions API does not return an official Kitchen category-tree membership for each product type. Browse-node enum labels inside schemas are the strongest Amazon-provided signal used here.',
    classificationLimitations:
      'Amazon Product Type Definitions API does not expose an official Kitchen hierarchy membership field. Classifications use schema recommended_browse_nodes labels starting with Kitchen > or Appliances > Small Appliances (excluding mid-path Kitchen under Automotive/RV, Kitchen > Vacuums/floor-care, and low kitchen-share generic types). Name/display-name inference is used only when browse-node evidence is absent and is not an official Amazon mapping.',
    workbookPath,
    allProductTypesJsonPath: allTypesPath,
    definitionsDir,
  }

  console.log('[amazon-uae-kitchen] Step 6: writing Excel workbook')
  await writeKitchenExtractionWorkbook(
    {
      kitchenRows,
      allRows,
      attributeRows,
      variationRows,
      failedRows,
      methodology,
    },
    workbookPath
  )

  const kitchenNameSet = new Set(kitchenRecords.map((r) => r.name))
  const allNameSet = new Set(records.map((r) => r.name))
  const kitchenMissingFromAll = [...kitchenNameSet].filter((n) => !allNameSet.has(n))
  const duplicateCodes = names.length - uniqueNames.length

  const summary = {
    marketplace: 'Amazon UAE',
    marketplaceId: MARKETPLACE_ID,
    locale: LOCALE,
    endpoint: sanitizeUrl(cfg.endpoint),
    extractedAt: methodology.extractionDate,
    keywordsUsed: false,
    totalUaeProductTypes: productTypes.length,
    uniqueProductTypeCodes: uniqueNames.length,
    duplicateProductTypeCodes: duplicateCodes,
    kitchenProductTypeCount: kitchenRecords.length,
    exactClassifications,
    inferredClassifications,
    successfulDefinitions,
    failedDefinitions,
    fetchedDefinitionsThisRun: fetched,
    resumedFromCache: cached,
    kitchenMissingFromAllCount: kitchenMissingFromAll.length,
    workbookPath,
    allProductTypesJsonPath: allTypesPath,
    definitionsDir,
    summaryPath,
    failedRequests: failedRows,
    kitchenProductTypes: kitchenRecords.map((r) => ({
      productType: r.name,
      displayName: r.displayName,
      kitchen_section: r.classification.kitchen_section,
      confidence: r.classification.confidence,
      classification_source: r.classification.classification_source,
      classification_reason: r.classification.classification_reason,
    })),
    limitations: methodology.classificationLimitations,
    officialMappingAvailable: methodology.officialMappingAvailable,
  }
  writeJson(summaryPath, summary)

  console.log('[amazon-uae-kitchen] Done')
  console.log(`[amazon-uae-kitchen] total=${summary.totalUaeProductTypes} kitchen=${summary.kitchenProductTypeCount}`)
  console.log(
    `[amazon-uae-kitchen] exact=${exactClassifications} inferred=${inferredClassifications} def_ok=${successfulDefinitions} def_fail=${failedDefinitions}`
  )
  console.log(`[amazon-uae-kitchen] workbook=${workbookPath}`)

  return summary
}

module.exports = {
  MARKETPLACE_ID,
  LOCALE,
  DEFAULT_OUTPUT_DIR,
  searchAllProductTypes,
  runAmazonUaeKitchenExtraction,
  loadOrFetchDefinition,
  withBackoffRetries,
}
