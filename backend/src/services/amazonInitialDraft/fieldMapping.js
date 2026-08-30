'use strict'

/**
 * The flat technical-header-to-value mapping.
 *
 * There is exactly one table and it is consulted identically for every row, whatever
 * product type that row declares. No entry branches on subtype, no entry carries
 * required-field metadata, and no entry is added or removed based on the workbook's
 * product type. A header that is not in the table is reported as ignored, never
 * treated as an error.
 *
 * Two attributes that earlier drafts of the plan wanted to populate are deliberately
 * report-only, because the template's own dropdowns prove their accepted vocabulary
 * differs per product type. Filling them correctly would require reading the subtype
 * column, which this feature must never do:
 *
 *   - `material`        six distinct vocabularies; COOKWARE_SET does not accept
 *                       "Stainless Steel" at all, which is this catalog's commonest value
 *   - `variation_theme` six distinct vocabularies, and the website's variant_type
 *                       (Single / Color / Multiple / Size) has no universal equivalent
 *
 * The units that *are* written were verified to share one vocabulary across every
 * product type in the template, so they are marketplace-level, not subtype-level.
 */

const {
  extractListItems,
  firstNonBlank,
  parseCount,
  parseMeasurement,
  parsePackageDimensions,
  readSpec,
  stripHtml,
} = require('./specParsers')

const BRAND_NAME = 'Life Smile'
const MANUFACTURER_NAME = 'Basmat Al Hayat General Trading LLC'

/**
 * Columns this feature must never write, whatever the mapping says. A guard rather
 * than a mapping concern: it is checked before the table is consulted.
 */
const NEVER_WRITE_PATTERNS = [
  { pattern: /image/i, reason: 'images-out-of-scope' },
  { pattern: /product_type|product_subtype|feed_product_type|item_type_keyword/i, reason: 'subtype-column' },
  { pattern: /record_action|update_delete/i, reason: 'listing-action-column' },
  { pattern: /price/i, reason: 'price-never-populated' },
  { pattern: /quantity/i, reason: 'quantity-never-populated' },
  { pattern: /contribution_sku|item_sku|seller_sku/i, reason: 'seller-sku-column' },
  // Life Smile does not offer an explicit Amazon warranty. Website "guarantee" wording
  // that appears inside a title or bullet is left alone; it must never become a warranty
  // field. Every warranty-shaped header is therefore a hard never-write.
  {
    pattern: /warranty|guarantee_description|warranty_description|warranty_type|warranty_duration/i,
    reason: 'warranty-never-write',
  },
]

function neverWriteReason(technicalHeader) {
  const match = NEVER_WRITE_PATTERNS.find((entry) => entry.pattern.test(technicalHeader))
  return match ? match.reason : null
}

function value(result, source, { numeric = false, constant = false, preferredLabels = null, compareAsText = false } = {}) {
  return {
    ok: true,
    value: result,
    numeric,
    source,
    constant,
    // When set, the generator must replace `value` with the workbook's exact accepted
    // option that represents one of these labels before writing.
    preferredLabels,
    // GTIN values must not be compared numerically or a leading zero is treated as identical.
    compareAsText,
  }
}

function missing(reason, detail) {
  return { ok: false, reason, detail: detail || null }
}

/**
 * A listing default whose exact stored string lives in the workbook's validation list.
 * The placeholder `value` is only a semantic hint; the generator writes the workbook's
 * own spelling after confirming it against the dropdown.
 */
function validatedDefault(preferredLabels, source) {
  return value(preferredLabels[0], source, { constant: true, preferredLabels })
}

/**
 * An attribute that fills a run of numbered columns rather than one cell, one entry per
 * column in order. `values` may be longer than the workbook has columns; the generator
 * writes what fits and reports the rest.
 */
function listValue(values, source) {
  return { ok: true, list: true, values, source }
}

/** Normalised keys whose columns are a numbered run to be filled in order. */
const LIST_KEYS = new Set(['bullet_point.value'])

/**
 * Derives every writable value for one matched catalog item.
 * Runs once per row; the resolvers below are plain lookups into the result.
 */
function resolveFieldsForItem(item) {
  const fields = new Map()

  const setField = (key, result) => fields.set(key, result)

  // --- Product identity -----------------------------------------------------
  const name = firstNonBlank(item.productName)
  setField('item_name.value', name ? value(name, 'products.name') : missing('no-database-value'))

  const description = stripHtml(item.longDescription) || stripHtml(item.shortDescription)
  setField(
    'product_description.value',
    description
      ? value(description, item.longDescription ? 'product_specifications.long_description' : 'product_specifications.short_description')
      : missing('no-database-value')
  )

  setField('brand.value', value(BRAND_NAME, 'constant', { constant: true }))
  setField('manufacturer.value', value(MANUFACTURER_NAME, 'constant', { constant: true }))

  // Product features. The website stores them as an ordered <li> list in
  // `short_description`, which is the only place a per-product feature list exists: the
  // `features` table is the admin permission registry, and the spec JSON holds attributes
  // rather than selling points. Order is the authoring order and is preserved. A variant
  // row carries its parent product's specification row, so a child inherits the parent's
  // features by construction.
  const features = extractListItems(item.shortDescription)
  setField(
    'bullet_point.value',
    features.length
      ? listValue(features, 'product_specifications.short_description')
      : missing('no-database-value')
  )

  // --- Product details ------------------------------------------------------
  const color = firstNonBlank(item.color)
  setField(
    'color.value',
    color ? value(color, item.matchSource === 'variant' ? 'product_variants.color' : 'products.color') : missing('no-database-value')
  )

  const size = firstNonBlank(item.size)
  setField(
    'size.value',
    size ? value(size, item.matchSource === 'variant' ? 'product_variants.size' : 'products.size') : missing('no-database-value')
  )

  // --- Universal listing defaults (validated against the workbook) ----------
  // These are marketplace-level constants for Life Smile UAE, not catalog lookups
  // and not subtype branches. The generator confirms each against the template's
  // own dropdown before writing; see validationOptions.js.
  setField(
    'amzn1.volt.ca.product_id_type',
    validatedDefault(['GTIN'], 'constant:product-identifier-type-gtin')
  )

  // Product ID / GTIN number comes from Zoho's barcode (upc), never invented here.
  // The pipeline attaches `item.zohoGtin` after an exact-SKU Zoho lookup + transform.
  if (item.zohoGtin && item.zohoGtin.ok && item.zohoGtin.amazonGtin) {
    setField(
      'amzn1.volt.ca.product_id_value',
      value(item.zohoGtin.amazonGtin, 'zoho.upc→gtin', { compareAsText: true })
    )
  } else {
    setField(
      'amzn1.volt.ca.product_id_value',
      missing(
        (item.zohoGtin && item.zohoGtin.reason) || 'zoho-barcode-unavailable',
        item.zohoGtin ? item.zohoGtin.originalZohoBarcode : null
      )
    )
  }
  setField(
    'supplier_declared_dg_hz_regulation.value',
    validatedDefault(['Not Applicable'], 'constant:dangerous-goods-not-applicable')
  )
  setField('condition_type.value', validatedDefault(['New'], 'constant:item-condition-new'))
  setField(
    'fulfillment_availability.fulfillment_channel_code',
    validatedDefault(
      ['Fulfilment by Amazon', 'Fulfillment by Amazon', 'AMAZON_NA', 'AMAZON_EU'],
      'constant:fulfillment-by-amazon'
    )
  )
  setField('country_of_origin.value', validatedDefault(['China', 'CN'], 'constant:country-of-origin-china'))
  setField(
    'batteries_required.value',
    validatedDefault(['No', 'False', '0'], 'constant:batteries-required-no')
  )
  setField(
    'contains_liquid_contents.value',
    validatedDefault(['No', 'False', '0'], 'constant:contains-liquid-no')
  )

  const capacityRaw = readSpec(item.specs, 'Capacity')
  const capacity = capacityRaw ? parseMeasurement(capacityRaw, 'volume') : missing('no-database-value')
  setField(
    'capacity.value',
    capacity.ok ? value(capacity.value, 'en_specifications.Capacity', { numeric: true }) : missing(capacity.reason, capacity.raw)
  )
  setField(
    'capacity.unit',
    capacity.ok ? value(capacity.unit, 'en_specifications.Capacity') : missing(capacity.reason, capacity.raw)
  )

  const piecesRaw = readSpec(item.specs, 'Pieces')
  const pieces = piecesRaw ? parseCount(piecesRaw) : missing('no-database-value')
  setField(
    'number_of_items.value',
    pieces.ok ? value(pieces.value, 'en_specifications.Pieces', { numeric: true }) : missing(pieces.reason, pieces.raw)
  )

  // --- Shipping: package measurements, never item measurements ---------------
  const weightRaw = readSpec(item.weightDimensions, 'Weight')
  const weight = weightRaw ? parseMeasurement(weightRaw, 'weight') : missing('no-database-value')
  setField(
    'item_package_weight.value',
    weight.ok ? value(weight.value, 'weight_dimensions.Weight', { numeric: true }) : missing(weight.reason, weight.raw)
  )
  setField(
    'item_package_weight.unit',
    weight.ok ? value(weight.unit, 'weight_dimensions.Weight') : missing(weight.reason, weight.raw)
  )

  const dimensionsRaw = readSpec(item.weightDimensions, 'Dimensions') || readSpec(item.weightDimensions, 'Dimension')
  const dimensions = dimensionsRaw ? parsePackageDimensions(dimensionsRaw) : missing('no-database-value')
  for (const axis of ['length', 'width', 'height']) {
    setField(
      `item_package_dimensions.${axis}.value`,
      dimensions.ok
        ? value(dimensions[axis], 'weight_dimensions.Dimensions', { numeric: true })
        : missing(dimensions.reason, dimensions.raw)
    )
    setField(
      `item_package_dimensions.${axis}.unit`,
      dimensions.ok ? value(dimensions.unit, 'weight_dimensions.Dimensions') : missing(dimensions.reason, dimensions.raw)
    )
  }

  // --- Variations -----------------------------------------------------------
  // Structural, not derived from variant_type: a row that matched a variant is a
  // child, a product that owns live variants is a parent, and a standalone product
  // is neither and is left blank.
  if (item.matchSource === 'variant') {
    setField('parentage_level.value', value('Child', 'derived:matched-a-variant'))
    const parentSku = firstNonBlank(item.parentItemCode)
    setField(
      'child_parent_sku_relationship.parent_sku',
      parentSku ? value(parentSku, 'products.item_code (parent)') : missing('no-database-value')
    )
  } else if (Number(item.variantCount) > 0) {
    setField('parentage_level.value', value('Parent', 'derived:product-owns-variants'))
    setField('child_parent_sku_relationship.parent_sku', missing('not-applicable-parent-row'))
  } else {
    setField('parentage_level.value', missing('not-applicable-standalone-product'))
    setField('child_parent_sku_relationship.parent_sku', missing('not-applicable-standalone-product'))
  }

  return fields
}

/** The normalised header keys this feature is able to populate. */
const MAPPED_KEYS = new Set([
  'item_name.value',
  'product_description.value',
  'bullet_point.value',
  'brand.value',
  'manufacturer.value',
  'color.value',
  'size.value',
  'amzn1.volt.ca.product_id_type',
  'amzn1.volt.ca.product_id_value',
  'supplier_declared_dg_hz_regulation.value',
  'condition_type.value',
  'fulfillment_availability.fulfillment_channel_code',
  'country_of_origin.value',
  'batteries_required.value',
  'contains_liquid_contents.value',
  'capacity.value',
  'capacity.unit',
  'number_of_items.value',
  'item_package_weight.value',
  'item_package_weight.unit',
  'item_package_dimensions.length.value',
  'item_package_dimensions.length.unit',
  'item_package_dimensions.width.value',
  'item_package_dimensions.width.unit',
  'item_package_dimensions.height.value',
  'item_package_dimensions.height.unit',
  'parentage_level.value',
  'child_parent_sku_relationship.parent_sku',
])

/**
 * Attributes held back on purpose, with the reason shown in the report so the choice
 * is visible to whoever finishes the draft.
 */
const REPORT_ONLY_NOTES = new Map([
  [
    'material.value',
    'Accepted values differ per product type in this template (six distinct lists); choosing one would require reading the subtype.',
  ],
  [
    'variation_theme.name',
    'Accepted themes differ per product type, and the website variant_type has no universal equivalent.',
  ],
])

module.exports = {
  BRAND_NAME,
  LIST_KEYS,
  MANUFACTURER_NAME,
  MAPPED_KEYS,
  NEVER_WRITE_PATTERNS,
  REPORT_ONLY_NOTES,
  neverWriteReason,
  resolveFieldsForItem,
}
