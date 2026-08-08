/** Frontend mirror of Noon order-id helper. Matching must use full item-level IDs. */

const NOON_PARENT_ORDER_RE = /^(NAE[I]?[A-Z0-9]+)$/i
const NOON_ITEM_ORDER_RE = /^(NAE[I]?[A-Z0-9]+)-(\d+)$/i

export function cleanNoonId(value: unknown): string {
  return String(value == null ? '' : value).trim()
}

export function parseNoonOrderId(value: unknown) {
  const original = cleanNoonId(value)
  if (!original) {
    return { original: '', parentOrderId: '', itemOrderId: '', itemSuffix: '', shape: 'empty' as const, recognized: false }
  }
  const itemMatch = NOON_ITEM_ORDER_RE.exec(original)
  if (itemMatch) {
    return {
      original,
      parentOrderId: itemMatch[1],
      itemOrderId: original,
      itemSuffix: itemMatch[2],
      shape: 'item' as const,
      recognized: true,
    }
  }
  if (NOON_PARENT_ORDER_RE.test(original)) {
    return {
      original,
      parentOrderId: original,
      itemOrderId: '',
      itemSuffix: '',
      shape: 'parent' as const,
      recognized: true,
    }
  }
  return { original, parentOrderId: '', itemOrderId: '', itemSuffix: '', shape: 'other' as const, recognized: false }
}

export function resolveNoonOrderIds(input: { orderNr?: string; itemNr?: string }) {
  const orderRaw = cleanNoonId(input.orderNr)
  const itemRaw = cleanNoonId(input.itemNr)
  const orderParsed = parseNoonOrderId(orderRaw)
  const itemParsed = parseNoonOrderId(itemRaw)

  if (itemParsed.shape === 'item') {
    return {
      parentOrderId: itemParsed.parentOrderId,
      itemOrderId: itemParsed.itemOrderId,
      itemSuffix: itemParsed.itemSuffix,
      hasItemLevelId: true,
    }
  }
  if (itemRaw && itemParsed.shape !== 'empty') {
    return {
      parentOrderId: orderParsed.shape === 'parent' || orderParsed.shape === 'item' ? orderParsed.parentOrderId : orderRaw || itemRaw,
      itemOrderId: itemRaw,
      itemSuffix: '',
      hasItemLevelId: true,
    }
  }
  if (orderParsed.shape === 'item') {
    return {
      parentOrderId: orderParsed.parentOrderId,
      itemOrderId: orderParsed.itemOrderId,
      itemSuffix: orderParsed.itemSuffix,
      hasItemLevelId: true,
    }
  }
  return {
    parentOrderId: orderParsed.parentOrderId || orderRaw,
    itemOrderId: '',
    itemSuffix: '',
    hasItemLevelId: false,
  }
}
