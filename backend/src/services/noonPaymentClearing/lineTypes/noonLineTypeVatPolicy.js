/**
 * VAT policy per line type.
 *
 * Two VAT strategies coexist in this module and both are correct, but until now
 * which one ran was an accident of which service happened to handle the row.
 * Naming them makes the choice reviewable:
 *
 *   COMPONENT_SUM   sums VAT across the "including VAT" columns. Right for fee
 *                   journals and return fee reversals, where the columns are the
 *                   authority.
 *   TOTAL_GROSS     splits VAT out of `row.total`. Right for settlement
 *                   adjustments, where component fields can disagree with Total
 *                   (626.82 + 7.61 of components against a 619.21 Total) and the
 *                   journal must tie to Total.
 *   DEFERRED_TO_RECLASS  gross parks on the uncleared GLs at payment time; VAT is
 *                   split later by the reclass journal. Splitting here would
 *                   double-count.
 *   NONE            product principal. Sale proceeds and return principal are
 *                   never service-fee VAT.
 */
const { round2, num } = require('../noonPaymentClearingCategoryService')
const {
  DEFAULT_VAT_RATE,
  extractVatFromNoonRow,
  splitVatInclusiveAmount,
  VAT_INCLUSIVE_COMPONENT_FIELDS,
} = require('../noonPaymentClearingVatService')

const VAT_POLICY = Object.freeze({
  NONE: 'none',
  COMPONENT_SUM: 'component_sum',
  TOTAL_GROSS: 'total_gross',
  DEFERRED_TO_RECLASS: 'deferred_to_reclass',
})

const VAT_POLICY_LABEL = Object.freeze({
  [VAT_POLICY.NONE]: 'No VAT (product principal)',
  [VAT_POLICY.COMPONENT_SUM]: 'VAT summed from including-VAT columns',
  [VAT_POLICY.TOTAL_GROSS]: 'VAT split from statement Total',
  [VAT_POLICY.DEFERRED_TO_RECLASS]: 'VAT deferred to the uncleared reclass journal',
})

function emptySplit(gross) {
  const g = round2(num(gross))
  return {
    vatInclusive: false,
    originalGrossAmount: g,
    netAmount: g,
    vatAmount: 0,
    vatSource: 'none',
  }
}

/** True when the row carries at least one "including VAT" service-fee column. */
function rowHasVatInclusiveServiceFee(row) {
  return VAT_INCLUSIVE_COMPONENT_FIELDS.some(
    (def) => Math.abs(num(row?.[def.field])) >= 0.005
  )
}

/**
 * Apply a line type's declared VAT policy to a row.
 *
 * @param {object} row statement row
 * @param {string} policy one of `VAT_POLICY`
 * @param {object} [options] `vatRate` defaults to the marketplace 5%
 * @returns {{vatInclusive: boolean, originalGrossAmount: number, netAmount: number, vatAmount: number, vatSource: string, policy: string}}
 */
function applyVatPolicy(row, policy, options = {}) {
  const vatRate = options.vatRate ?? DEFAULT_VAT_RATE
  const gross = round2(num(row?.total))

  if (policy === VAT_POLICY.COMPONENT_SUM) {
    const breakdown = extractVatFromNoonRow(row, { vatRate })
    return {
      policy,
      vatInclusive: breakdown.vatInclusive,
      originalGrossAmount: breakdown.originalGrossAmount,
      netAmount: breakdown.netAmount,
      vatAmount: breakdown.vatAmount,
      vatSource: breakdown.vatSource,
      components: breakdown.components,
      nonVatResidue: breakdown.nonVatResidue,
      tiesOut: breakdown.tiesOut,
    }
  }

  if (policy === VAT_POLICY.TOTAL_GROSS) {
    if (!rowHasVatInclusiveServiceFee(row)) {
      return { ...emptySplit(gross), policy }
    }
    const split = splitVatInclusiveAmount(round2(Math.abs(gross)), vatRate)
    return {
      policy,
      vatInclusive: split.vatInclusive,
      originalGrossAmount: split.originalGrossAmount,
      netAmount: split.netAmount,
      vatAmount: split.vatAmount,
      vatSource: split.vatSource,
    }
  }

  // NONE and DEFERRED_TO_RECLASS both mean "do not split here". They are kept
  // distinct because only one of them expects VAT to appear later.
  return { ...emptySplit(gross), policy }
}

module.exports = {
  VAT_POLICY,
  VAT_POLICY_LABEL,
  applyVatPolicy,
  rowHasVatInclusiveServiceFee,
}
