const GENERATED_FIELD_KEYS = [
  'item_name',
  'product_description',
  'bullet_point_1',
  'bullet_point_2',
  'bullet_point_3',
  'bullet_point_4',
  'bullet_point_5',
]

function hasColumn(columns, key) {
  return columns.some((c) => c.key === key)
}

function isEmpty(v) {
  return String(v == null ? '' : v).trim() === ''
}

function validateRow(row, columns, duplicateSkus = new Set()) {
  const values = row.current_values || row.currentValues || {}
  const errors = []
  const warnings = []
  const sku = String(row.sku || values.sku || values.item_sku || '').trim()
  if (!sku) errors.push({ field: 'sku', message: 'Missing SKU' })
  if (duplicateSkus.has(sku)) errors.push({ field: 'sku', message: 'Duplicate SKU in batch' })

  const requiredIfPresent = [
    ['brand_name', 'Missing brand'],
    ['manufacturer', 'Missing manufacturer'],
    ['product_type', 'Missing product type'],
    ['listing_action', 'Missing listing action'],
    ['product_id_type', 'Missing product id type'],
    ['product_id', 'Missing product id'],
    ['recommended_browse_nodes', 'Missing recommended browse node'],
    ['item_condition', 'Missing item condition'],
  ]
  for (const [key, message] of requiredIfPresent) {
    if (hasColumn(columns, key) && isEmpty(values[key])) warnings.push({ field: key, message })
  }

  for (const key of GENERATED_FIELD_KEYS) {
    if (hasColumn(columns, key) && isEmpty(values[key])) {
      warnings.push({ field: key, message: `${key.replaceAll('_', ' ')} is empty` })
    }
  }

  if (hasColumn(columns, 'item_name') && !isEmpty(values.item_name)) {
    const title = String(values.item_name)
    if (!/^LIFE SMILE\b/i.test(title)) warnings.push({ field: 'item_name', message: 'Title should start with LIFE SMILE' })
    if (title.length > 200) warnings.push({ field: 'item_name', message: 'Title is longer than 200 characters' })
  }

  const compliance = [
    ['are_batteries_required', 'Missing batteries required value'],
    ['dangerous_goods_regulations', 'Missing dangerous goods regulations'],
    ['country_of_origin', 'Missing country of origin'],
  ]
  for (const [key, message] of compliance) {
    if (hasColumn(columns, key) && isEmpty(values[key])) warnings.push({ field: key, message })
  }

  return { errors, warnings }
}

function qualityCheck(values, columns) {
  const issues = []
  const itemName = String(values.item_name || '').trim()
  if (hasColumn(columns, 'item_name') && !/^LIFE SMILE\b/i.test(itemName)) issues.push('Title does not start with LIFE SMILE')
  if (hasColumn(columns, 'item_name') && itemName.length > 200) issues.push('Title too long')
  for (let i = 1; i <= 5; i++) {
    const key = `bullet_point_${i}`
    if (hasColumn(columns, key) && isEmpty(values[key])) issues.push(`Bullet ${i} missing`)
  }
  if (hasColumn(columns, 'product_description') && isEmpty(values.product_description)) issues.push('Description missing')
  const score = Math.max(0, 100 - issues.length * 15)
  return { score, level: score >= 85 ? 'high' : score >= 60 ? 'medium' : 'needs_review', issues }
}

function nextStatusFromValidation(currentStatus, validation) {
  if (validation.errors.length > 0) return 'Validation Error'
  if (['Generated', 'Needs Review', 'Approved', 'Saved', 'Exported'].includes(currentStatus)) return currentStatus
  return 'Ready'
}

module.exports = {
  GENERATED_FIELD_KEYS,
  validateRow,
  qualityCheck,
  nextStatusFromValidation,
}
