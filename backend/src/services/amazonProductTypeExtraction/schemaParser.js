'use strict'

/**
 * Parse Amazon Product Type Definition JSON Schema documents (LISTING).
 */

/**
 * @param {unknown} node
 * @param {string} [path]
 * @param {Array<{ path: string, enum: string[], enumNames?: string[] }>} [out]
 * @param {number} [depth]
 */
function collectEnums(node, path = '', out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return out
  if (Array.isArray(node.enum)) {
    out.push({
      path,
      enum: node.enum.map((v) => String(v)),
      enumNames: Array.isArray(node.enumNames) ? node.enumNames.map((v) => String(v)) : undefined,
    })
  }
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectEnums(child, path ? `${path}[${i}]` : `[${i}]`, out, depth + 1))
    return out
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'enum' || key === 'enumNames') continue
    collectEnums(value, path ? `${path}.${key}` : key, out, depth + 1)
  }
  return out
}

/**
 * @param {unknown} schema
 * @param {string} attributeName
 * @returns {{ values: string[], labels: string[] }}
 */
function extractAttributeEnums(schema, attributeName) {
  const props = schema && typeof schema === 'object' ? schema.properties : null
  const attr = props && props[attributeName]
  if (!attr) return { values: [], labels: [] }
  const found = collectEnums(attr)
  const values = []
  const labels = []
  const seen = new Set()
  for (const entry of found) {
    for (let i = 0; i < entry.enum.length; i += 1) {
      const v = entry.enum[i]
      if (seen.has(v)) continue
      seen.add(v)
      values.push(v)
      labels.push(entry.enumNames && entry.enumNames[i] != null ? entry.enumNames[i] : v)
    }
  }
  return { values, labels }
}

/**
 * @param {unknown} schema
 * @returns {string[]}
 */
function extractRequiredAttributes(schema) {
  if (!schema || typeof schema !== 'object') return []
  const required = Array.isArray(schema.required) ? schema.required.map((x) => String(x)) : []
  return [...new Set(required)]
}

/**
 * Detect conditionally required attributes from JSON Schema allOf if/then.
 * @param {unknown} schema
 * @returns {string[]}
 */
function extractConditionallyRequiredAttributes(schema) {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.allOf)) return []
  const base = new Set(extractRequiredAttributes(schema))
  const conditional = new Set()
  for (const clause of schema.allOf) {
    if (!clause || typeof clause !== 'object') continue
    const thenBlock = clause.then
    if (!thenBlock || typeof thenBlock !== 'object') continue
    const req = Array.isArray(thenBlock.required) ? thenBlock.required : []
    for (const name of req) {
      const n = String(name)
      if (!base.has(n)) conditional.add(n)
    }
  }
  return [...conditional]
}

/**
 * @param {unknown} schema
 * @param {string} name
 */
function getAttributeMeta(schema, name) {
  const props = schema && typeof schema === 'object' ? schema.properties : null
  const attr = props && props[name]
  if (!attr || typeof attr !== 'object') {
    return {
      name,
      displayName: name,
      dataType: '',
      description: '',
      allowedValues: '',
      unitValues: '',
    }
  }
  const enums = collectEnums(attr)
  const allowed = []
  for (const entry of enums) {
    if (/unit/i.test(entry.path)) continue
    for (const v of entry.enum) allowed.push(v)
  }
  const units = []
  for (const entry of enums) {
    if (!/unit/i.test(entry.path)) continue
    for (const v of entry.enum) units.push(v)
  }
  return {
    name,
    displayName: attr.title != null ? String(attr.title) : name,
    dataType: attr.type != null ? String(attr.type) : '',
    description: attr.description != null ? String(attr.description) : '',
    allowedValues: [...new Set(allowed)].slice(0, 80).join(' | '),
    unitValues: [...new Set(units)].slice(0, 40).join(' | '),
  }
}

/**
 * @param {unknown} schema
 */
function extractVariationSupport(schema) {
  const props = schema && typeof schema === 'object' ? schema.properties : null
  const hasParentage = Boolean(props && props.parentage_level)
  const hasTheme = Boolean(props && props.variation_theme)
  const themes = extractAttributeEnums(schema, 'variation_theme').values
  let parentSupported = false
  let childSupported = false
  if (hasParentage) {
    const levels = extractAttributeEnums(schema, 'parentage_level').values.map((v) => v.toLowerCase())
    parentSupported = levels.includes('parent')
    childSupported = levels.includes('child')
    if (!levels.length) {
      parentSupported = true
      childSupported = true
    }
  }
  return {
    variationSupported: hasParentage || hasTheme || themes.length > 0,
    parentSupported,
    childSupported,
    variationThemes: themes,
  }
}

/**
 * @param {unknown} schema
 */
function extractBrowseNodeEvidence(schema) {
  const { values, labels } = extractAttributeEnums(schema, 'recommended_browse_nodes')
  return {
    browseNodeIds: values,
    browseNodeLabels: labels,
  }
}

/**
 * @param {unknown} schema
 */
function extractItemTypeKeywords(schema) {
  return extractAttributeEnums(schema, 'item_type_keyword').values
}

/**
 * Full schema extraction used by workbook rows.
 * @param {unknown} schema
 * @param {object} [definition]
 */
function extractSchemaSummary(schema, definition = null) {
  const required = extractRequiredAttributes(schema)
  const conditional = extractConditionallyRequiredAttributes(schema)
  const variation = extractVariationSupport(schema)
  const browse = extractBrowseNodeEvidence(schema)
  const itemTypeKeywords = extractItemTypeKeywords(schema)
  const version =
    definition && definition.productTypeVersion && typeof definition.productTypeVersion === 'object'
      ? String(definition.productTypeVersion.version || '')
      : definition && definition.productTypeVersion != null
        ? String(definition.productTypeVersion)
        : ''

  return {
    requiredAttributes: required,
    conditionallyRequiredAttributes: conditional,
    requiredAttributeDetails: required.map((name) => ({
      ...getAttributeMeta(schema, name),
      requirementType: 'REQUIRED',
    })),
    conditionalAttributeDetails: conditional.map((name) => ({
      ...getAttributeMeta(schema, name),
      requirementType: 'CONDITIONALLY_REQUIRED',
    })),
    ...variation,
    itemTypeKeywords,
    recommendedBrowseNodeIds: browse.browseNodeIds,
    recommendedBrowseNodeLabels: browse.browseNodeLabels,
    schemaVersion: version,
    propertyGroups:
      definition && definition.propertyGroups && typeof definition.propertyGroups === 'object'
        ? Object.keys(definition.propertyGroups)
        : [],
  }
}

module.exports = {
  collectEnums,
  extractAttributeEnums,
  extractRequiredAttributes,
  extractConditionallyRequiredAttributes,
  getAttributeMeta,
  extractVariationSupport,
  extractBrowseNodeEvidence,
  extractItemTypeKeywords,
  extractSchemaSummary,
}
