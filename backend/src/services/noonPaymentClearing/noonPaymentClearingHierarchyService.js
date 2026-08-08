const { ROW_CLASS, round2, num, clean } = require('./noonPaymentClearingCategoryService')
const { resolveNoonOrderIds } = require('./noonOrderIdHelper')

function emptyMoney() {
  return {
    netProceed: 0,
    referralFee: 0,
    fulfillmentFee: 0,
    shippingCharges: 0,
    otherOrderFees: 0,
    othersInclVat: 0,
    nonOrderFees: 0,
    total: 0,
  }
}

function addMoney(target, row) {
  target.netProceed = round2(target.netProceed + num(row.netProceed))
  target.referralFee = round2(target.referralFee + num(row.referralFee))
  target.fulfillmentFee = round2(target.fulfillmentFee + num(row.fulfillmentFee))
  target.shippingCharges = round2(target.shippingCharges + num(row.shippingCharges))
  target.otherOrderFees = round2(target.otherOrderFees + num(row.otherOrderFees))
  target.othersInclVat = round2(target.othersInclVat + num(row.othersInclVat))
  target.nonOrderFees = round2(target.nonOrderFees + num(row.nonOrderFees))
  target.total = round2(target.total + num(row.total))
}

/**
 * Group statement rows under parent Noon orders for UI / reconciliation.
 * Does NOT merge child invoices — children stay separate.
 */
function buildNoonOrderHierarchy(rows) {
  const list = Array.isArray(rows) ? rows : []
  const parents = new Map()
  const statementFees = []
  const ungrouped = []

  for (const row of list) {
    const ids = resolveNoonOrderIds({ orderNr: row.orderNr, itemNr: row.itemNr })
    const parentId = ids.parentOrderId || clean(row.parentOrderId)
    const itemId = ids.itemOrderId || clean(row.itemOrderId)
    const rowClass = row.rowClass || ''

    if (rowClass === ROW_CLASS.STATEMENT_FEE || (!parentId && !itemId && rowClass !== ROW_CLASS.SALE_ITEM)) {
      if (rowClass === ROW_CLASS.STATEMENT_FEE || !parentId) {
        statementFees.push(row)
        continue
      }
    }

    if (!parentId) {
      ungrouped.push(row)
      continue
    }

    if (!parents.has(parentId)) {
      parents.set(parentId, {
        parentOrderId: parentId,
        children: [],
        parentCharges: [],
        adjustments: [],
        rows: [],
        totals: emptyMoney(),
      })
    }
    const group = parents.get(parentId)
    group.rows.push(row)
    addMoney(group.totals, row)

    if (rowClass === ROW_CLASS.PARENT_ORDER_CHARGE) {
      group.parentCharges.push(row)
      continue
    }
    if (rowClass === ROW_CLASS.ORDER_ADJUSTMENT) {
      group.adjustments.push(row)
      continue
    }
    if (rowClass === ROW_CLASS.SALE_ITEM || itemId) {
      const childKey = itemId || `${parentId}::sku:${clean(row.sku || row.partnerSku)}::row:${row.rowNumber}`
      let child = group.children.find((c) => c.itemOrderId === childKey || (itemId && c.itemOrderId === itemId))
      if (!child) {
        child = {
          itemOrderId: itemId || childKey,
          parentOrderId: parentId,
          sku: clean(row.sku),
          partnerSku: clean(row.partnerSku),
          title: clean(row.title),
          rows: [],
          totals: emptyMoney(),
          matchStatus: row.matchStatus || 'pending',
          zohoInvoiceId: row.zohoInvoiceId || '',
          zohoInvoiceNumber: row.zohoInvoiceNumber || '',
        }
        group.children.push(child)
      }
      child.rows.push(row)
      addMoney(child.totals, row)
      if (row.sku) child.sku = clean(row.sku)
      if (row.partnerSku) child.partnerSku = clean(row.partnerSku)
      if (row.title) child.title = clean(row.title)
      if (row.matchStatus) child.matchStatus = row.matchStatus
      if (row.zohoInvoiceId) child.zohoInvoiceId = row.zohoInvoiceId
      if (row.zohoInvoiceNumber) child.zohoInvoiceNumber = row.zohoInvoiceNumber
      continue
    }

    // Fallback: keep under parent as adjustment-like
    group.adjustments.push(row)
  }

  const parentGroups = Array.from(parents.values()).sort((a, b) =>
    a.parentOrderId.localeCompare(b.parentOrderId)
  )

  return {
    parentGroups,
    statementFees,
    ungrouped,
    summary: {
      parentCount: parentGroups.length,
      childItemCount: parentGroups.reduce((acc, g) => acc + g.children.length, 0),
      parentChargeRowCount: parentGroups.reduce((acc, g) => acc + g.parentCharges.length, 0),
      adjustmentRowCount: parentGroups.reduce((acc, g) => acc + g.adjustments.length, 0),
      statementFeeRowCount: statementFees.length,
    },
  }
}

module.exports = {
  buildNoonOrderHierarchy,
}
