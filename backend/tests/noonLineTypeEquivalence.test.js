/**
 * Proof that routing through the line type registry did not change any routing
 * decision.
 *
 * Both consumers are exercised over a cartesian product of row shapes — far
 * wider than the shapes any fixture contains — and compared against the exact
 * predicate logic that preceded the registry. This is what makes "restructure
 * with identical numbers" a check rather than a claim, and it will fail loudly
 * if someone later changes a registry rule believing it to be cosmetic.
 *
 * Rows are reclassified first because every real consumer does that before
 * asking either question.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
  ROW_CLASS,
  num,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingCategoryService')
const {
  resolveLineType,
  vetoesRecordPayment,
  LINE_SECTION,
} = require('../src/services/noonPaymentClearing/lineTypes/noonLineTypeRegistry')
const {
  isZeroSaleCrossWeekLogisticsSettlementRow,
  isPaidInvoiceSubsidyAdjustmentRow,
  isSameWeekPositiveParentSubsidyRow,
  isCrossWeekSettlementAdjustmentRow,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingSettlementAdjustmentService')
const {
  reclassifyReturnRows,
} = require('../src/services/noonPaymentClearing/noonPaymentClearingReturnService')

/** The Record Payment filter exactly as it read before the registry. */
function legacyEffectiveNetProceed(row, item) {
  if (row && row.netProceed != null && row.netProceed !== '') {
    const rowNet = num(row.netProceed)
    if (rowNet <= -0.01) return rowNet
    if (rowNet > -0.01 && rowNet < 0.01) return rowNet
  }
  return num(item.netProceed)
}

function legacyKeepsForRecordPayment(row, item, saleParentSet) {
  if (row?.rowClass === ROW_CLASS.RETURN) return false
  if (row && row.netProceed != null && row.netProceed !== '' && num(row.netProceed) <= -0.01) {
    return false
  }
  if (legacyEffectiveNetProceed(row, item) < 0.01) return false
  if (row && isZeroSaleCrossWeekLogisticsSettlementRow(row, saleParentSet)) return false
  return true
}

/** isSettlementAdjustmentSourceRow exactly as it read before the registry. */
function legacyIsAdjustmentSource(row, planExclusions, saleParentSet) {
  if (!row) return false
  if (row.rowClass === ROW_CLASS.RETURN) return false
  if (isPaidInvoiceSubsidyAdjustmentRow(row, planExclusions)) return true
  if (isZeroSaleCrossWeekLogisticsSettlementRow(row, saleParentSet)) return true
  if (isSameWeekPositiveParentSubsidyRow(row, saleParentSet)) return true
  if (row.excludeFromPaymentClearing) return false
  return isCrossWeekSettlementAdjustmentRow(row, saleParentSet)
}

const ROW_CLASSES = [
  ROW_CLASS.SALE_ITEM,
  ROW_CLASS.PARENT_ORDER_CHARGE,
  ROW_CLASS.ORDER_ADJUSTMENT,
  ROW_CLASS.RETURN,
  ROW_CLASS.STATEMENT_FEE,
  ROW_CLASS.OTHER,
]
const NET_PROCEEDS = [-133, -0.5, 0, 0.005, 0.5, 759]
const FULFILLMENTS = [0, -13.1, 7.56]
const TOTALS = [-112.05, -0.5, 0, 7.56, 605.86]
const FLAGS = [false, true]
const TX_TYPES = ['order', 'order_update']
const ITEM_NET_PROCEEDS = [0, 133, 759]

/** Every combination of the shapes a Noon statement row can take. */
function* rowShapes() {
  let rowNumber = 0
  for (const rowClass of ROW_CLASSES)
    for (const netProceed of NET_PROCEEDS)
      for (const fulfillmentFee of FULFILLMENTS)
        for (const total of TOTALS)
          for (const excludeFromPaymentClearing of FLAGS)
            for (const paidInvoiceSubsidy of FLAGS)
              for (const inSale of FLAGS)
                for (const transactionType of TX_TYPES) {
                  rowNumber += 1
                  const raw = {
                    rowNumber,
                    rowClass,
                    transactionType,
                    parentOrderId: 'NAEI70012345678',
                    itemOrderId: 'NAEI70012345678-1',
                    assignedZohoInvoiceId: 'inv-1',
                    netProceed,
                    referralFee: 0,
                    fulfillmentFee,
                    shippingCharges: 0,
                    total,
                    excludeFromPaymentClearing,
                    paidInvoiceSubsidy,
                  }
                  const saleParentSet = new Set(inSale ? ['naei70012345678'] : [])
                  const [row] = reclassifyReturnRows([raw], saleParentSet)
                  yield {
                    row,
                    saleParentSet,
                    ctx: {
                      saleParentSet,
                      excludedInvoiceIds: new Set(),
                      excludedItemOrderIds: new Set(),
                    },
                  }
                }
}

function describeRow(row, extra = {}) {
  return JSON.stringify({
    rowClass: row.rowClass,
    netProceed: row.netProceed,
    fulfillmentFee: row.fulfillmentFee,
    total: row.total,
    excluded: row.excludeFromPaymentClearing,
    paidInvoiceSubsidy: row.paidInvoiceSubsidy,
    ...extra,
  })
}

describe('Line type routing matches the pre-registry behaviour', () => {
  it('keeps the same rows on Record Payment', () => {
    let checked = 0
    const divergences = []
    for (const { row, saleParentSet, ctx } of rowShapes()) {
      for (const itemNetProceed of ITEM_NET_PROCEEDS) {
        const item = { itemOrderId: 'NAEI70012345678-1', netProceed: itemNetProceed }
        const legacy = legacyKeepsForRecordPayment(row, item, saleParentSet)
        const viaRegistry =
          !vetoesRecordPayment(row, ctx) && legacyEffectiveNetProceed(row, item) >= 0.01
        checked += 1
        if (legacy !== viaRegistry) {
          divergences.push(
            describeRow(row, {
              itemNetProceed,
              legacy,
              viaRegistry,
              resolved: resolveLineType(row, ctx).id,
            })
          )
        }
      }
    }
    assert.ok(checked > 20000, `expected a wide sweep, only checked ${checked}`)
    assert.deepEqual(divergences.slice(0, 5), [], `${divergences.length} of ${checked} diverged`)
  })

  it('sends the same rows to the settlement adjustment journal', () => {
    let checked = 0
    const divergences = []
    for (const { row, saleParentSet, ctx } of rowShapes()) {
      const legacy = legacyIsAdjustmentSource(row, null, saleParentSet)
      const viaRegistry = resolveLineType(row, ctx).section === LINE_SECTION.SETTLEMENT_ADJUSTMENTS
      checked += 1
      if (legacy !== viaRegistry) {
        divergences.push(
          describeRow(row, { legacy, viaRegistry, resolved: resolveLineType(row, ctx).id })
        )
      }
    }
    assert.ok(checked > 8000, `expected a wide sweep, only checked ${checked}`)
    assert.deepEqual(divergences.slice(0, 5), [], `${divergences.length} of ${checked} diverged`)
  })

  it('never puts a return or a negative-proceeds row on Record Payment', () => {
    for (const { row, ctx } of rowShapes()) {
      if (num(row.netProceed) > -0.01 && row.rowClass !== ROW_CLASS.RETURN) continue
      assert.equal(
        vetoesRecordPayment(row, ctx),
        true,
        `negative or return row reached Record Payment: ${describeRow(row)}`
      )
    }
  })
})
