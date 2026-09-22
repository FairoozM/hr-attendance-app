#!/usr/bin/env node
/**
 * Rebuild kitchen classification + Excel from cached definitions (no Amazon API calls).
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { extractSchemaSummary } = require('../src/services/amazonProductTypeExtraction/schemaParser')
const { classifyKitchenProductType } = require('../src/services/amazonProductTypeExtraction/kitchenClassifier')
const { writeKitchenExtractionWorkbook } = require('../src/services/amazonProductTypeExtraction/workbookBuilder')
const { sanitizeUrl } = require('../src/services/amazonProductTypeExtraction/urlSanitize')

const OUTPUT_DIR = path.resolve(__dirname, '../data/amazon-uae-kitchen-catalogue')
const MARKETPLACE_ID = 'A2VIGQ35RCS4UG'
const LOCALE = 'en_AE'

function joinList(values) {
  return (values || []).map((v) => String(v)).join(' | ')
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function main() {
  const allTypesPath = path.join(OUTPUT_DIR, 'amazon_uae_all_product_types.json')
  const definitionsDir = path.join(OUTPUT_DIR, 'amazon_uae_product_type_definitions')
  const workbookPath = path.join(OUTPUT_DIR, 'amazon_uae_kitchen_product_types.xlsx')
  const summaryPath = path.join(OUTPUT_DIR, 'amazon_uae_kitchen_extraction_summary.json')

  const listPayload = JSON.parse(fs.readFileSync(allTypesPath, 'utf8'))
  const productTypes = listPayload.productTypes || []
  const failedRows = []
  const records = []

  for (const pt of productTypes) {
    const name = String(pt.name || '').trim()
    if (!name) continue
    const cacheFile = path.join(definitionsDir, `${name.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`)
    const loaded = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    const displayName =
      (loaded.definition && loaded.definition.displayName) ||
      String(pt.displayName != null ? pt.displayName : name)

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
    } else {
      failedRows.push({
        productType: name,
        request: loaded.request || '',
        httpStatus: loaded.httpStatus || 0,
        attemptCount: loaded.attemptCount || 1,
        error: loaded.error || 'failed',
        lastAttempt: loaded.retrievedAt || '',
      })
    }

    const classification = classifyKitchenProductType({
      name,
      displayName,
      browseNodeLabels: schemaSummary.recommendedBrowseNodeLabels,
      itemTypeKeywords: schemaSummary.itemTypeKeywords,
      propertyGroups: schemaSummary.propertyGroups,
    })

    records.push({ name, displayName, loaded, schemaSummary, classification })
  }

  const kitchenRecords = records.filter((r) => r.classification.is_kitchen)
  const successfulDefinitions = records.filter((r) => r.loaded.retrievalStatus === 'success').length
  const failedDefinitions = records.length - successfulDefinitions
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
    baseUrl: 'https://sellingpartnerapi-eu.amazon.com',
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
      'No. Product Type Definitions API does not return an official Kitchen category-tree membership for each product type. Browse-node enum labels inside schemas (paths starting with Kitchen > or Appliances > Small Appliances) are the strongest Amazon-provided signal used here.',
    classificationLimitations:
      'Mid-path Kitchen segments (e.g. Automotive/RV), Kitchen > Vacuums/floor-care nodes, name-only false positives (KETTLEBELL, THERMOSTAT, SANITARY_NAPKIN), and product types whose Kitchen browse-node share is under 15% without a kitchen name cue were excluded. Types without Kitchen/small-appliance browse-node labels were classified only by product-type code/display-name inference and are not official Amazon hierarchy mappings.',
    workbookPath,
    allProductTypesJsonPath: allTypesPath,
    definitionsDir,
  }

  await writeKitchenExtractionWorkbook(
    { kitchenRows, allRows, attributeRows, variationRows, failedRows, methodology },
    workbookPath
  )

  const summary = {
    marketplace: 'Amazon UAE',
    marketplaceId: MARKETPLACE_ID,
    locale: LOCALE,
    endpoint: sanitizeUrl('https://sellingpartnerapi-eu.amazon.com'),
    extractedAt: methodology.extractionDate,
    keywordsUsed: false,
    totalUaeProductTypes: productTypes.length,
    uniqueProductTypeCodes: productTypes.length,
    duplicateProductTypeCodes: 0,
    kitchenProductTypeCount: kitchenRecords.length,
    exactClassifications,
    inferredClassifications,
    successfulDefinitions,
    failedDefinitions,
    fetchedDefinitionsThisRun: 0,
    resumedFromCache: successfulDefinitions,
    kitchenMissingFromAllCount: 0,
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
    reclassifiedFromCache: true,
  }
  writeJson(summaryPath, summary)
  console.log(
    `Reclassified kitchen=${summary.kitchenProductTypeCount} exact=${exactClassifications} inferred=${inferredClassifications}`
  )
  console.log(`Workbook: ${workbookPath}`)
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e)
  process.exit(1)
})
