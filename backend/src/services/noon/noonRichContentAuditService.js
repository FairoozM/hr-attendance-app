const {
  getNoonProductSnapshotsForAudit,
  normalizeCountryCode,
} = require('./noonSnapshotStore')

const MAX_SAMPLES = 5

const GROUP_RULES = [
  { group: 'description', patterns: ['description', 'longdescription', 'shortdescription', 'productdescription'] },
  { group: 'features', patterns: ['feature', 'features', 'keyfeatures', 'sellingpoints', 'highlight', 'highlights'] },
  { group: 'bulletPoints', patterns: ['bullet', 'bullets', 'bulletpoints'] },
  { group: 'images', patterns: ['image', 'imageurl', 'imageurls', 'images', 'media', 'gallery'] },
  { group: 'brand', patterns: ['brand'] },
  { group: 'category', patterns: ['category', 'categorypath', 'producttype', 'productsubtype', 'family'] },
  { group: 'color', patterns: ['color', 'colour', 'pattern'] },
  { group: 'size', patterns: ['size', 'capacity', 'volume', 'diameter'] },
  { group: 'material', patterns: ['material'] },
  { group: 'weight', patterns: ['weight', 'itemweight', 'packageweight', 'shippingweight'] },
  { group: 'dimensions', patterns: ['dimension', 'dimensions', 'itemdimensions', 'packagedimensions', 'length', 'width', 'height', 'depth'] },
  { group: 'identifiers', patterns: ['barcode', 'pbarcode', 'gtin', 'ean', 'upc', 'isbn'] },
  { group: 'variation', patterns: ['variation', 'variationtheme', 'parentsku', 'childsku', 'parent', 'child'] },
  { group: 'model', patterns: ['model', 'modelnumber'] },
]

function normalizePath(path) {
  return String(path || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function displayValue(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isMeaningfulValue(value) {
  if (value == null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function flattenJson(value, prefix = '') {
  const entries = []
  if (!isMeaningfulValue(value)) return entries

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const nextPath = `${prefix}[${index}]`
      if (item && typeof item === 'object') {
        entries.push(...flattenJson(item, nextPath))
      } else if (isMeaningfulValue(item)) {
        entries.push({ path: nextPath, value: item })
      }
    })
    return entries
  }

  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const nextPath = prefix ? `${prefix}.${key}` : key
      if (entry && typeof entry === 'object') {
        entries.push(...flattenJson(entry, nextPath))
      } else if (isMeaningfulValue(entry)) {
        entries.push({ path: nextPath, value: entry })
      }
    }
    return entries
  }

  entries.push({ path: prefix || 'value', value })
  return entries
}

function groupsForPath(path) {
  const normalized = normalizePath(path)
  const groups = []
  for (const rule of GROUP_RULES) {
    if (rule.patterns.some((pattern) => normalized.includes(normalizePath(pattern)))) {
      groups.push(rule.group)
    }
  }
  return groups
}

function fieldGroupForResponse(group) {
  if (group === 'bulletPoints') return 'features'
  if (group === 'images') return 'images'
  if (group === 'identifiers' || group === 'model') return 'identifiers'
  if (group === 'color' || group === 'size' || group === 'material') return group
  return group || 'other'
}

function addSample(list, value) {
  const text = displayValue(value)
  if (!text || list.includes(text) || list.length >= MAX_SAMPLES) return
  list.push(text.length > 300 ? `${text.slice(0, 300)}...` : text)
}

function addSkuSample(list, sku) {
  if (!sku || list.includes(sku) || list.length >= MAX_SAMPLES) return
  list.push(sku)
}

function percentage(count, total) {
  if (!total) return 0
  return Math.round((count / total) * 1000) / 10
}

function makeConclusion(summary, totalRows) {
  const coverage = (count) => percentage(count, totalRows)
  const titleCoverage = coverage(summary.titleCount)
  const featureCoverage = coverage(Math.max(summary.featuresCount, summary.bulletPointsCount))
  const imageCoverage = coverage(summary.imageCount)
  const dimensionCoverage = coverage(summary.dimensionsCount)
  const weightCoverage = coverage(summary.weightCount)
  const barcodeCoverage = coverage(summary.barcodeCount)
  const positiveSignals = [
    titleCoverage >= 80,
    featureCoverage >= 50,
    imageCoverage >= 80,
    dimensionCoverage >= 50 || weightCoverage >= 50,
    barcodeCoverage >= 80,
  ].filter(Boolean).length

  return {
    enoughForAmazonTitle: titleCoverage >= 80,
    enoughForAmazonBulletsFeatures: featureCoverage >= 50,
    enoughForAmazonDimensionsWeight: dimensionCoverage >= 50 || weightCoverage >= 50,
    enoughForAmazonImages: imageCoverage >= 80,
    enoughForBarcodeMatching: barcodeCoverage >= 80,
    overallAmazonUsefulness: positiveSignals >= 4 ? 'high' : positiveSignals >= 2 ? 'medium' : 'low',
  }
}

async function auditNoonRichContent(options = {}) {
  const countryCode = normalizeCountryCode(options.countryCode || options.country_code)
  const rows = await getNoonProductSnapshotsForAudit(countryCode)
  const totalRows = rows.length
  const fieldMap = new Map()
  const skuCoverage = []

  const summary = {
    titleCount: 0,
    descriptionCount: 0,
    featuresCount: 0,
    bulletPointsCount: 0,
    imageCount: 0,
    brandCount: 0,
    categoryCount: 0,
    colorCount: 0,
    sizeCount: 0,
    materialCount: 0,
    weightCount: 0,
    dimensionsCount: 0,
    barcodeCount: 0,
    variationCount: 0,
  }

  for (const row of rows) {
    const partnerSku = row.partner_sku
    const matchedGroups = new Set()
    const matchedPaths = []

    if (row.title) {
      summary.titleCount += 1
    }
    if (row.image_url) matchedGroups.add('images')
    if (row.barcode || row.pbarcode) matchedGroups.add('identifiers')

    const sources = [
      { source: 'catalog', json: row.raw_catalog_json || {} },
      { source: 'pricing', json: row.raw_pricing_json || {} },
    ]

    for (const sourceInfo of sources) {
      for (const entry of flattenJson(sourceInfo.json)) {
        const groups = groupsForPath(entry.path)
        if (!groups.length) continue

        for (const group of groups) {
          matchedGroups.add(group)
          matchedPaths.push({
            group,
            source: sourceInfo.source,
            path: entry.path,
            value: displayValue(entry.value),
          })

          const key = `${sourceInfo.source}:${group}:${entry.path}`
          if (!fieldMap.has(key)) {
            fieldMap.set(key, {
              group: fieldGroupForResponse(group),
              source: sourceInfo.source,
              path: entry.path,
              skus: new Set(),
              sampleValues: [],
              sampleSkus: [],
            })
          }
          const field = fieldMap.get(key)
          field.skus.add(partnerSku)
          addSample(field.sampleValues, entry.value)
          addSkuSample(field.sampleSkus, partnerSku)
        }
      }
    }

    const hasDescription = matchedGroups.has('description')
    const hasFeatures = matchedGroups.has('features')
    const hasBulletPoints = matchedGroups.has('bulletPoints')
    const hasImages = matchedGroups.has('images')
    const hasBrand = matchedGroups.has('brand')
    const hasCategory = matchedGroups.has('category')
    const hasColor = matchedGroups.has('color')
    const hasSize = matchedGroups.has('size')
    const hasMaterial = matchedGroups.has('material')
    const hasWeight = matchedGroups.has('weight')
    const hasDimensions = matchedGroups.has('dimensions')
    const hasBarcode = matchedGroups.has('identifiers')
    const hasVariation = matchedGroups.has('variation')

    if (hasDescription) summary.descriptionCount += 1
    if (hasFeatures) summary.featuresCount += 1
    if (hasBulletPoints) summary.bulletPointsCount += 1
    if (hasImages) summary.imageCount += 1
    if (hasBrand) summary.brandCount += 1
    if (hasCategory) summary.categoryCount += 1
    if (hasColor) summary.colorCount += 1
    if (hasSize) summary.sizeCount += 1
    if (hasMaterial) summary.materialCount += 1
    if (hasWeight) summary.weightCount += 1
    if (hasDimensions) summary.dimensionsCount += 1
    if (hasBarcode) summary.barcodeCount += 1
    if (hasVariation) summary.variationCount += 1

    skuCoverage.push({
      partnerSku,
      noonSku: row.noon_sku,
      title: row.title,
      hasDescription,
      hasFeatures,
      hasBulletPoints,
      hasImages,
      hasBrand,
      hasCategory,
      hasColor,
      hasSize,
      hasMaterial,
      hasWeight,
      hasDimensions,
      hasBarcode,
      hasVariation,
      matchedPaths,
    })
  }

  const fields = Array.from(fieldMap.values())
    .map((field) => ({
      group: field.group,
      source: field.source,
      path: field.path,
      count: field.skus.size,
      percentage: percentage(field.skus.size, totalRows),
      sampleValues: field.sampleValues,
      sampleSkus: field.sampleSkus,
    }))
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group) || a.path.localeCompare(b.path))

  return {
    ok: true,
    countryCode,
    totalRows,
    summary,
    conclusion: makeConclusion(summary, totalRows),
    fields,
    skuCoverage,
  }
}

module.exports = {
  auditNoonRichContent,
  flattenJson,
}
