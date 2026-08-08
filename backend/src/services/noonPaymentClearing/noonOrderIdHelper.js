/**
 * Noon-specific order ID normalization.
 * Recognized item IDs look like NAEI70003640128-4 (parent + numeric suffix).
 * Never strip -N from arbitrary strings — only recognized Noon order identifiers.
 */

function clean(value) {
  return String(value == null ? '' : value).trim()
}

/** Parent-shaped Noon order IDs (no item suffix). */
const NOON_PARENT_ORDER_RE = /^(NAE[I]?[A-Z0-9]+)$/i
/** Item-shaped Noon order IDs: parent-N */
const NOON_ITEM_ORDER_RE = /^(NAE[I]?[A-Z0-9]+)-(\d+)$/i

function matchKey(value) {
  return clean(value).toLowerCase().replace(/\s+/g, '')
}

function isRecognizedNoonParentOrderId(value) {
  return NOON_PARENT_ORDER_RE.test(clean(value))
}

function isRecognizedNoonItemOrderId(value) {
  return NOON_ITEM_ORDER_RE.test(clean(value))
}

/**
 * Parse a single Noon order identifier into parent / item / suffix.
 * Preserves the original string always.
 */
function parseNoonOrderId(value) {
  const original = clean(value)
  if (!original) {
    return {
      original: '',
      parentOrderId: '',
      itemOrderId: '',
      itemSuffix: '',
      shape: 'empty',
      recognized: false,
    }
  }
  const itemMatch = NOON_ITEM_ORDER_RE.exec(original)
  if (itemMatch) {
    return {
      original,
      parentOrderId: itemMatch[1],
      itemOrderId: original,
      itemSuffix: itemMatch[2],
      shape: 'item',
      recognized: true,
    }
  }
  // Normalize casing for recognized parents while keeping original separately.
  if (NOON_PARENT_ORDER_RE.test(original)) {
    return {
      original,
      parentOrderId: original,
      itemOrderId: '',
      itemSuffix: '',
      shape: 'parent',
      recognized: true,
    }
  }
  return {
    original,
    parentOrderId: '',
    itemOrderId: '',
    itemSuffix: '',
    shape: 'other',
    recognized: false,
  }
}

/**
 * Derive parent_order_id + item_order_id from Noon statement Order Nr / Item Nr.
 * Never throws either identifier away. Matching must use item_order_id only.
 */
function resolveNoonOrderIds({ orderNr, itemNr } = {}) {
  const orderRaw = clean(orderNr)
  const itemRaw = clean(itemNr)
  const orderParsed = parseNoonOrderId(orderRaw)
  const itemParsed = parseNoonOrderId(itemRaw)

  let parentOrderId = ''
  let itemOrderId = ''
  let itemSuffix = ''

  if (itemParsed.shape === 'item') {
    parentOrderId = itemParsed.parentOrderId
    itemOrderId = itemParsed.itemOrderId
    itemSuffix = itemParsed.itemSuffix
  } else if (itemRaw && itemParsed.shape !== 'empty') {
    // Item Nr present but not suffix-shaped — still treat as item-level match key.
    itemOrderId = itemRaw
    if (orderParsed.shape === 'parent') parentOrderId = orderParsed.parentOrderId
    else if (orderParsed.shape === 'item') parentOrderId = orderParsed.parentOrderId
    else if (itemParsed.shape === 'parent') parentOrderId = itemParsed.parentOrderId
    else parentOrderId = orderRaw || itemRaw
  } else if (orderParsed.shape === 'item') {
    parentOrderId = orderParsed.parentOrderId
    itemOrderId = orderParsed.itemOrderId
    itemSuffix = orderParsed.itemSuffix
  } else if (orderParsed.shape === 'parent') {
    parentOrderId = orderParsed.parentOrderId
    itemOrderId = ''
  } else {
    parentOrderId = orderRaw || itemRaw
    itemOrderId = itemRaw && itemRaw !== orderRaw ? itemRaw : ''
  }

  // If Order Nr is parent and Item Nr equals Order Nr (common in fee rows), keep parent only.
  if (
    orderParsed.shape === 'parent' &&
    itemRaw &&
    matchKey(itemRaw) === matchKey(orderRaw)
  ) {
    parentOrderId = orderParsed.parentOrderId
    itemOrderId = ''
    itemSuffix = ''
  }

  return {
    orderNrOriginal: orderRaw,
    itemNrOriginal: itemRaw,
    parentOrderId,
    itemOrderId,
    itemSuffix,
    /** True when we have a distinct item-level ID for Zoho invoice matching. */
    hasItemLevelId: Boolean(itemOrderId),
    /** True when identifiers look like recognized Noon NAE/NAEI forms. */
    recognized: orderParsed.recognized || itemParsed.recognized,
  }
}

/**
 * Parent-only match against a child invoice PO must never succeed for sales.
 * Returns true if candidateKey is exactly the parent of itemOrderId (or equals parentOrderId)
 * and is NOT equal to the full itemOrderId.
 */
function isParentOnlyMatch({ candidate, itemOrderId, parentOrderId } = {}) {
  const cand = matchKey(candidate)
  const item = matchKey(itemOrderId)
  const parent = matchKey(parentOrderId)
  if (!cand) return false
  if (item && cand === item) return false
  if (parent && cand === parent) return true
  if (item) {
    const parsed = parseNoonOrderId(itemOrderId)
    if (parsed.shape === 'item' && cand === matchKey(parsed.parentOrderId)) return true
  }
  return false
}

module.exports = {
  clean,
  matchKey,
  isRecognizedNoonParentOrderId,
  isRecognizedNoonItemOrderId,
  parseNoonOrderId,
  resolveNoonOrderIds,
  isParentOnlyMatch,
  NOON_PARENT_ORDER_RE,
  NOON_ITEM_ORDER_RE,
}
