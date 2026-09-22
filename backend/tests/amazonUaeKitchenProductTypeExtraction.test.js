'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const os = require('os')
const path = require('path')
const fs = require('fs')
const ExcelJS = require('exceljs')

const { sanitizeUrl, redactDefinitionLinks } = require('../src/services/amazonProductTypeExtraction/urlSanitize')
const {
  extractSchemaSummary,
  extractRequiredAttributes,
  extractConditionallyRequiredAttributes,
} = require('../src/services/amazonProductTypeExtraction/schemaParser')
const {
  classifyKitchenProductType,
  isHomeKitchenBrowsePath,
} = require('../src/services/amazonProductTypeExtraction/kitchenClassifier')
const { writeKitchenExtractionWorkbook } = require('../src/services/amazonProductTypeExtraction/workbookBuilder')

describe('amazon UAE kitchen extraction helpers', () => {
  it('sanitizes signed schema URLs', () => {
    const raw =
      'https://selling-partner-definitions-prod-dub.s3.eu-west-1.amazonaws.com/schema/COOKWARE_SET.json/abc?X-Amz-Signature=secret'
    assert.equal(
      sanitizeUrl(raw),
      'https://selling-partner-definitions-prod-dub.s3.eu-west-1.amazonaws.com/schema/COOKWARE_SET.json/abc'
    )
    const redacted = redactDefinitionLinks({
      schema: { link: { resource: raw, verb: 'GET' }, checksum: 'x' },
    })
    assert.equal(redacted.schema.link.resource.includes('X-Amz-Signature'), false)
  })

  it('parses required and conditional attributes from schema', () => {
    const schema = {
      required: ['brand', 'item_name'],
      properties: {
        brand: { title: 'Brand', type: 'array', description: 'Brand name' },
        item_name: { title: 'Item Name', type: 'array' },
        color: { title: 'Color', type: 'array' },
        variation_theme: {
          title: 'Variation Theme',
          type: 'array',
          items: { properties: { name: { enum: ['COLOR', 'SIZE'], enumNames: ['COLOR', 'SIZE'] } } },
        },
        parentage_level: {
          items: { properties: { value: { enum: ['parent', 'child'] } } },
        },
        recommended_browse_nodes: {
          items: {
            properties: {
              value: {
                anyOf: [
                  {},
                  {
                    enum: ['1'],
                    enumNames: ['Kitchen > Cookware > Pots & Pans > Sets'],
                  },
                ],
              },
            },
          },
        },
      },
      allOf: [{ if: { required: ['parentage_level'] }, then: { required: ['color'] } }],
    }
    assert.deepEqual(extractRequiredAttributes(schema), ['brand', 'item_name'])
    assert.deepEqual(extractConditionallyRequiredAttributes(schema), ['color'])
    const summary = extractSchemaSummary(schema, {
      productTypeVersion: { version: 'v1', latest: true },
      propertyGroups: { variations: {}, offer: {} },
    })
    assert.equal(summary.variationSupported, true)
    assert.equal(summary.parentSupported, true)
    assert.equal(summary.childSupported, true)
    assert.deepEqual(summary.variationThemes, ['COLOR', 'SIZE'])
    assert.ok(summary.recommendedBrowseNodeLabels[0].includes('Kitchen > Cookware'))
  })

  it('classifies Kitchen from browse nodes as exact, and excludes false positives', () => {
    const cookware = classifyKitchenProductType({
      name: 'COOKWARE_SET',
      displayName: 'Cookware Set',
      browseNodeLabels: ['Kitchen > Cookware > Pots & Pans > Sets'],
    })
    assert.equal(cookware.is_kitchen, true)
    assert.equal(cookware.confidence, 'exact')
    assert.equal(cookware.classification_source, 'schema_recommended_browse_nodes')
    assert.match(cookware.kitchen_section, /Cookware/i)

    const toy = classifyKitchenProductType({
      name: 'TOY_KITCHEN',
      displayName: 'Toy Kitchen',
      browseNodeLabels: [],
    })
    assert.equal(toy.is_kitchen, false)
    assert.equal(toy.classification_source, 'exclusion_rules')

    const campingOnly = classifyKitchenProductType({
      name: 'CAMP_POT',
      displayName: 'Camp Pot',
      browseNodeLabels: [
        'Sporting Goods > Outdoor Recreation > Camping & Hiking > Camp Kitchen > Cookware',
      ],
    })
    assert.equal(campingOnly.is_kitchen, false)
    assert.equal(
      isHomeKitchenBrowsePath(
        'Sporting Goods > Outdoor Recreation > Camping & Hiking > Camp Kitchen > Cookware'
      ),
      false
    )

    const autoAccessory = classifyKitchenProductType({
      name: 'AUTO_ACCESSORY',
      displayName: 'Auto Accessory',
      browseNodeLabels: [
        'Automotive > RV Parts & Accessories > Fitting & Assembly Parts > Furnishings & Appliances > Kitchen > Sink & Burner Combos',
      ],
    })
    assert.equal(autoAccessory.is_kitchen, false)

    const kettlebell = classifyKitchenProductType({
      name: 'KETTLEBELL',
      displayName: 'Kettlebell',
      browseNodeLabels: [],
    })
    assert.equal(kettlebell.is_kitchen, false)

    const airFryer = classifyKitchenProductType({
      name: 'AIR_FRYER',
      displayName: 'Air Fryer',
      browseNodeLabels: ['Appliances > Small Appliances > Fryers > Air Fryers'],
    })
    assert.equal(airFryer.is_kitchen, true)
    assert.equal(airFryer.confidence, 'exact')

    const inferred = classifyKitchenProductType({
      name: 'SAUTE_FRY_PAN',
      displayName: 'Saute Fry Pan',
      browseNodeLabels: [],
    })
    assert.equal(inferred.is_kitchen, true)
    assert.ok(['high', 'medium'].includes(inferred.confidence))
    assert.notEqual(inferred.classification_source, 'schema_recommended_browse_nodes')
  })

  it('writes workbook with all expected worksheets', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-kitchen-xlsx-'))
    const filePath = path.join(dir, 'amazon_uae_kitchen_product_types.xlsx')
    await writeKitchenExtractionWorkbook(
      {
        kitchenRows: [
          {
            productType: 'COOKWARE_SET',
            displayName: 'Cookware Set',
            kitchenSection: 'Cookware sets',
            confidence: 'exact',
            classificationSource: 'schema_recommended_browse_nodes',
            classificationReason: 'Kitchen > Cookware',
            requiredAttributeCount: 6,
            variationSupported: 'Yes',
            variationThemes: 'COLOR',
            itemTypeKeywords: '',
            recommendedBrowseNodes: 'Kitchen > Cookware > Pots & Pans > Sets',
            schemaVersion: 'v1',
            retrievalStatus: 'success',
            retrievedAt: '2026-09-11T00:00:00.000Z',
            error: '',
          },
        ],
        allRows: [
          {
            productType: 'COOKWARE_SET',
            displayName: 'Cookware Set',
            isKitchen: 'Yes',
            kitchenSection: 'Cookware sets',
            confidence: 'exact',
            classificationSource: 'schema_recommended_browse_nodes',
            classificationReason: 'Kitchen > Cookware',
            definitionStatus: 'success',
          },
          {
            productType: 'LUGGAGE',
            displayName: 'Luggage',
            isKitchen: 'No',
            kitchenSection: '',
            confidence: '',
            classificationSource: 'none',
            classificationReason: 'No Kitchen evidence',
            definitionStatus: 'success',
          },
        ],
        attributeRows: [
          {
            productType: 'COOKWARE_SET',
            displayName: 'Cookware Set',
            attributeName: 'brand',
            attributeDisplayName: 'Brand',
            requirementType: 'REQUIRED',
            dataType: 'array',
            allowedValues: '',
            unitValues: '',
            attributeDescription: 'Brand name',
          },
        ],
        variationRows: [
          {
            productType: 'COOKWARE_SET',
            displayName: 'Cookware Set',
            variationTheme: 'COLOR',
            parentSupported: 'Yes',
            childSupported: 'Yes',
          },
        ],
        failedRows: [],
        methodology: {
          marketplace: 'Amazon UAE',
          marketplaceId: 'A2VIGQ35RCS4UG',
          endpointRegion: 'Europe',
          baseUrl: 'https://sellingpartnerapi-eu.amazon.com',
          locale: 'en_AE',
          extractionDate: '2026-09-11T00:00:00.000Z',
          apiOperations: 'searchDefinitionsProductTypes',
          keywordsUsed: 'No',
          totalUaeProductTypes: 2,
          kitchenCount: 1,
          successfulDefinitions: 2,
          failedDefinitions: 0,
          exactClassifications: 1,
          inferredClassifications: 0,
          officialMappingAvailable: 'No',
          classificationLimitations: 'Inferred when browse nodes absent',
          workbookPath: filePath,
          allProductTypesJsonPath: 'x.json',
          definitionsDir: 'defs',
        },
      },
      filePath
    )

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const names = wb.worksheets.map((s) => s.name)
    assert.deepEqual(names, [
      'Kitchen Product Types',
      'All UAE Product Types',
      'Required Attributes',
      'Variation Themes',
      'Failed Requests',
      'Methodology',
    ])
    assert.equal(wb.getWorksheet('Kitchen Product Types').rowCount >= 2, true)
    assert.equal(wb.getWorksheet('All UAE Product Types').rowCount >= 3, true)
  })
})
