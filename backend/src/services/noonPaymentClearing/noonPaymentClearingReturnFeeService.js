const { round2, num, clean } = require('./noonPaymentClearingCategoryService')
const { buildSettlementReference, buildEntryReference } = require('./noonPaymentClearingReferenceService')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const {
  buildNoonReturnFeeBreakdown,
  buildReturnDescription,
  collectReturnRows,
  isNoonReturnRow,
  TOLERANCE,
} = require('./noonPaymentClearingReturnService')

function normalizeGlAccount(account = null, fallbackName = '') {
  if (!account) return { accountId: '', accountName: fallbackName, accountCode: '' }
  return {
    accountId: clean(account.accountId),
    accountName: clean(account.accountName) || fallbackName,
    accountCode: clean(account.accountCode),
  }
}

function returnFeeAccounts(cfg) {
  return {
    UNDEPOSITED: normalizeGlAccount(cfg.undepositedFundsAccount, 'Noon Undeposited Funds'),
    COMMISSION: normalizeGlAccount(cfg.unclearedCommissionAccount, 'Noon Uncleared Commission'),
    SHIPPING: normalizeGlAccount(cfg.unclearedShippingAccount, 'Noon Uncleared Shipping'),
    COMMISSION_EXPENSE: normalizeGlAccount(cfg.commissionExpenseAccount, 'Noon Commission Expense'),
    SHIPPING_EXPENSE: normalizeGlAccount(cfg.shippingExpenseAccount, 'Noon Shipping Expense'),
    INPUT_VAT: normalizeGlAccount(cfg.inputVatAccount, 'Input VAT'),
  }
}

function buildSettlementReversalLine({
  row,
  metadata,
  accounts,
  breakdown,
  feeKind,
  gross,
  net,
  vat,
  creditAccountKey,
}) {
  const itemOrderId = breakdown.itemOrderId
  const settlementReference = buildSettlementReference(metadata)
  const entry = buildEntryReference(settlementReference, `return_${feeKind}_settlement`, itemOrderId)
  const normalizedFeeType =
    feeKind === 'commission' ? 'RETURN_COMMISSION_SETTLEMENT' : 'RETURN_FULFILLMENT_SETTLEMENT'
  const creditAccount = accounts[creditAccountKey]
  return {
    phase: 'settlement',
    key: `return-${feeKind}-settlement-${itemOrderId}`,
    postingGroupKey: `return_fee_settlement:${feeKind}:${itemOrderId}`,
    rowNumber: row.rowNumber,
    itemOrderId,
    parentOrderId: breakdown.parentOrderId,
    feeType: `return_${feeKind}_settlement`,
    normalizedFeeType,
    grossAmount: gross,
    netAmount: net,
    vatAmount: vat,
    undepositedImpact: gross,
    referenceNumber: entry.referenceNumber,
    description:
      feeKind === 'commission'
        ? buildReturnDescription(row, metadata, 'commission')
        : `Noon fulfillment reversal | ${itemOrderId} | ${clean(metadata.referenceNr)} | Gross ${gross}`,
    status: 'ready',
    debit: { ...accounts.UNDEPOSITED, amount: gross },
    creditCommission: creditAccountKey === 'COMMISSION' ? { ...creditAccount, amount: gross } : null,
    creditShipping: creditAccountKey === 'SHIPPING' ? { ...creditAccount, amount: gross } : null,
    creditVat: null,
  }
}

function buildExpenseReversalLine({
  row,
  metadata,
  accounts,
  breakdown,
  feeKind,
  gross,
  net,
  vat,
  unclearedAccountKey,
  expenseAccountKey,
}) {
  const itemOrderId = breakdown.itemOrderId
  const settlementReference = buildSettlementReference(metadata)
  const entry = buildEntryReference(settlementReference, `return_${feeKind}_expense_reversal`, itemOrderId)
  const normalizedFeeType =
    feeKind === 'commission' ? 'RETURN_COMMISSION_EXPENSE_REVERSAL' : 'RETURN_FULFILLMENT_EXPENSE_REVERSAL'
  return {
    phase: 'expense_reversal',
    key: `return-${feeKind}-expense-${itemOrderId}`,
    postingGroupKey: `return_fee_expense_reversal:${feeKind}:${itemOrderId}`,
    rowNumber: row.rowNumber,
    itemOrderId,
    parentOrderId: breakdown.parentOrderId,
    feeType: `return_${feeKind}_expense_reversal`,
    normalizedFeeType,
    grossAmount: gross,
    netAmount: net,
    vatAmount: vat,
    undepositedImpact: 0,
    referenceNumber: entry.referenceNumber,
    description:
      feeKind === 'commission'
        ? `Noon commission expense reversal | ${itemOrderId} | ${clean(metadata.referenceNr)} | Gross ${gross}`
        : `Noon shipping expense reversal | ${itemOrderId} | ${clean(metadata.referenceNr)} | Gross ${gross}`,
    vatDescription:
      feeKind === 'commission'
        ? buildReturnDescription(row, metadata, 'vat')
        : `Noon VAT reversal | ${itemOrderId} | ${clean(metadata.referenceNr)} | Gross ${gross}`,
    status: 'ready',
    debitUncleared: { ...accounts[unclearedAccountKey], amount: gross },
    creditExpense: { ...accounts[expenseAccountKey], amount: net },
    creditVat: vat >= TOLERANCE ? { ...accounts.INPUT_VAT, amount: vat } : null,
  }
}

function buildReturnFeeJournalLinesForRow(row, batch, metadata = {}, cfg = null) {
  const marketplaceCfg = cfg || getNoonPaymentClearingMarketplaceConfig()
  const accounts = returnFeeAccounts(marketplaceCfg)
  const breakdown = buildNoonReturnFeeBreakdown(row)
  const meta = batch?.reportSnapshot || batch?.metadata || metadata
  const lines = []

  if (breakdown.commissionReversalGross >= TOLERANCE) {
    const gross = breakdown.commissionReversalGross
    lines.push(
      buildSettlementReversalLine({
        row,
        metadata: meta,
        accounts,
        breakdown,
        feeKind: 'commission',
        gross,
        net: breakdown.commissionReversalNet,
        vat: breakdown.commissionReversalVat,
        creditAccountKey: 'COMMISSION',
      }),
      buildExpenseReversalLine({
        row,
        metadata: meta,
        accounts,
        breakdown,
        feeKind: 'commission',
        gross,
        net: breakdown.commissionReversalNet,
        vat: breakdown.commissionReversalVat,
        unclearedAccountKey: 'COMMISSION',
        expenseAccountKey: 'COMMISSION_EXPENSE',
      })
    )
  }

  if (breakdown.fulfillmentReversalGross >= TOLERANCE) {
    const gross = breakdown.fulfillmentReversalGross
    lines.push(
      buildSettlementReversalLine({
        row,
        metadata: meta,
        accounts,
        breakdown,
        feeKind: 'fulfillment',
        gross,
        net: breakdown.fulfillmentReversalNet,
        vat: breakdown.fulfillmentReversalVat,
        creditAccountKey: 'SHIPPING',
      }),
      buildExpenseReversalLine({
        row,
        metadata: meta,
        accounts,
        breakdown,
        feeKind: 'fulfillment',
        gross,
        net: breakdown.fulfillmentReversalNet,
        vat: breakdown.fulfillmentReversalVat,
        unclearedAccountKey: 'SHIPPING',
        expenseAccountKey: 'SHIPPING_EXPENSE',
      })
    )
  }

  return { breakdown, lines }
}

function appendJournalLineToZohoItems(zohoLineItems, line) {
  if (line.phase === 'expense_reversal') {
    zohoLineItems.push({
      account_id: line.debitUncleared.accountId,
      account_name: line.debitUncleared.accountName,
      debit_or_credit: 'debit',
      amount: line.debitUncleared.amount,
      description: line.description,
    })
    zohoLineItems.push({
      account_id: line.creditExpense.accountId,
      account_name: line.creditExpense.accountName,
      debit_or_credit: 'credit',
      amount: line.creditExpense.amount,
      description: line.description,
    })
    if (line.creditVat) {
      zohoLineItems.push({
        account_id: line.creditVat.accountId,
        account_name: line.creditVat.accountName,
        debit_or_credit: 'credit',
        amount: line.creditVat.amount,
        description: line.vatDescription || line.description,
      })
    }
    return
  }

  zohoLineItems.push({
    account_id: line.debit.accountId,
    account_name: line.debit.accountName,
    debit_or_credit: 'debit',
    amount: line.debit.amount,
    description: line.description,
  })
  if (line.creditCommission) {
    zohoLineItems.push({
      account_id: line.creditCommission.accountId,
      account_name: line.creditCommission.accountName,
      debit_or_credit: 'credit',
      amount: line.creditCommission.amount,
      description: line.description,
    })
  }
  if (line.creditShipping) {
    zohoLineItems.push({
      account_id: line.creditShipping.accountId,
      account_name: line.creditShipping.accountName,
      debit_or_credit: 'credit',
      amount: line.creditShipping.amount,
      description: line.description,
    })
  }
}

function buildReturnFeePlan(batch, allRows = null) {
  const rows = allRows || batch?.allRows || []
  const metadata = batch?.reportSnapshot || batch?.metadata || {}
  const cfg = getNoonPaymentClearingMarketplaceConfig()
  const returnRows = collectReturnRows(rows)
  const perOrder = []
  const journalLines = []
  let totalUndepositedImpact = 0

  for (const row of returnRows) {
    const matched = (batch?.matchedReturns || []).find(
      (m) => clean(m.itemOrderId) === clean(row.itemOrderId) && m.status === 'matched'
    )
    if (!matched) continue
    const { breakdown, lines } = buildReturnFeeJournalLinesForRow(row, batch, metadata, cfg)
    perOrder.push({ row, breakdown, matched, lines })
    journalLines.push(...lines)
    for (const line of lines) {
      if (line.phase === 'settlement') {
        totalUndepositedImpact = round2(totalUndepositedImpact + num(line.undepositedImpact))
      }
    }
  }

  const settlementJournalLines = journalLines.filter((line) => line.phase === 'settlement')
  const expenseReversalJournalLines = journalLines.filter((line) => line.phase === 'expense_reversal')
  const zohoLineItems = []
  for (const line of journalLines) {
    appendJournalLineToZohoItems(zohoLineItems, line)
  }

  return {
    returnRowCount: returnRows.length,
    perOrder,
    journalLines,
    settlementJournalLines,
    expenseReversalJournalLines,
    zohoLineItems,
    totalUndepositedImpact: round2(totalUndepositedImpact),
    settlementReference: buildSettlementReference(metadata),
    summary: {
      settlementJournalCount: settlementJournalLines.length,
      expenseReversalJournalCount: expenseReversalJournalLines.length,
      totalJournalCount: journalLines.length,
    },
  }
}

function summarizeReturnFeeReversals(allRows = []) {
  return collectReturnRows(allRows).map((row) => {
    const b = buildNoonReturnFeeBreakdown(row)
    return {
      rowNumber: row.rowNumber,
      itemOrderId: b.itemOrderId,
      parentOrderId: b.parentOrderId,
      commissionReversalGross: b.commissionReversalGross,
      commissionReversalNet: b.commissionReversalNet,
      commissionReversalVat: b.commissionReversalVat,
      fulfillmentReversalGross: b.fulfillmentReversalGross,
      netSettlementEffect: b.netSettlementEffect,
    }
  })
}

/**
 * Shared ledger simulation for uncleared GL after sale reclass + Phase 3 return clearing.
 */
function proveUnclearedAccountNetsToZero({
  accountCode,
  saleGrossAmount,
  settlementLine,
  expenseLine,
  settlementCreditAccessor,
  expenseDebitAccessor,
  expenseCreditField,
  vatCreditField,
  assumeSaleReclassApplied = true,
}) {
  const saleGross = round2(Math.abs(num(saleGrossAmount)))
  const returnCredit = round2(num(settlementCreditAccessor(settlementLine)))
  const expenseDebit = round2(num(expenseDebitAccessor(expenseLine)))
  const startingBalance = assumeSaleReclassApplied ? 0 : saleGross
  const balanceAfterSettlement = round2(startingBalance - returnCredit)
  const balanceAfterReturn = round2(balanceAfterSettlement + expenseDebit)
  return {
    accountCode,
    saleGrossAmount: saleGross,
    returnCredit,
    expenseDebit,
    expenseCredit: round2(num(expenseLine?.[expenseCreditField]?.amount)),
    expenseCreditVat: round2(num(expenseLine?.[vatCreditField]?.amount)),
    startingBalance,
    balanceAfterSettlement,
    balanceAfterReturn,
    returnCreditMatchesSaleGross:
      saleGross < TOLERANCE || Math.abs(returnCredit - saleGross) < TOLERANCE,
    netsToZero: Math.abs(balanceAfterReturn) < TOLERANCE,
    settlementLine,
    expenseLine,
  }
}

/**
 * Simulate 1067 through return Phase 3 (settlement + expense reversal).
 * Default: sale-week reclass already cleared 1067 to 0 before the return settlement runs.
 */
function proveUnclearedCommission1067NetsToZero(saleReferralFee, returnRow, batch = {}, options = {}) {
  const plan = buildReturnFeePlan(batch, [returnRow])
  const settlementLine = (plan.settlementJournalLines || []).find(
    (line) => line.normalizedFeeType === 'RETURN_COMMISSION_SETTLEMENT'
  )
  const expenseLine = (plan.expenseReversalJournalLines || []).find(
    (line) => line.normalizedFeeType === 'RETURN_COMMISSION_EXPENSE_REVERSAL'
  )
  const proof = proveUnclearedAccountNetsToZero({
    accountCode: '1067',
    saleGrossAmount: saleReferralFee,
    settlementLine,
    expenseLine,
    settlementCreditAccessor: (line) => line?.creditCommission?.amount,
    expenseDebitAccessor: (line) => line?.debitUncleared?.amount,
    expenseCreditField: 'creditExpense',
    vatCreditField: 'creditVat',
    assumeSaleReclassApplied: options.assumeSaleReclassApplied !== false,
  })
  return {
    saleCommission1067: proof.saleGrossAmount,
    returnCredit1067: proof.returnCredit,
    expenseDebit1067: proof.expenseDebit,
    expenseCredit2143: proof.expenseCredit,
    expenseCredit1085: proof.expenseCreditVat,
    startingBalance1067: proof.startingBalance,
    balanceAfterSettlement: proof.balanceAfterSettlement,
    balance1067AfterReturn: proof.balanceAfterReturn,
    returnCreditMatchesSaleCommission: proof.returnCreditMatchesSaleGross,
    netsToZero: proof.netsToZero,
    settlementLine: proof.settlementLine,
    expenseLine: proof.expenseLine,
    plan,
  }
}

/**
 * Simulate 1068 through return Phase 3 (settlement + expense reversal).
 * Default: sale-week reclass already cleared 1068 to 0 before the return settlement runs.
 */
function proveUnclearedShipping1068NetsToZero(saleFulfillmentFee, returnRow, batch = {}, options = {}) {
  const plan = buildReturnFeePlan(batch, [returnRow])
  const settlementLine = (plan.settlementJournalLines || []).find(
    (line) => line.normalizedFeeType === 'RETURN_FULFILLMENT_SETTLEMENT'
  )
  const expenseLine = (plan.expenseReversalJournalLines || []).find(
    (line) => line.normalizedFeeType === 'RETURN_FULFILLMENT_EXPENSE_REVERSAL'
  )
  const proof = proveUnclearedAccountNetsToZero({
    accountCode: '1068',
    saleGrossAmount: saleFulfillmentFee,
    settlementLine,
    expenseLine,
    settlementCreditAccessor: (line) => line?.creditShipping?.amount,
    expenseDebitAccessor: (line) => line?.debitUncleared?.amount,
    expenseCreditField: 'creditExpense',
    vatCreditField: 'creditVat',
    assumeSaleReclassApplied: options.assumeSaleReclassApplied !== false,
  })
  return {
    saleShipping1068: proof.saleGrossAmount,
    returnCredit1068: proof.returnCredit,
    expenseDebit1068: proof.expenseDebit,
    expenseCredit2162: proof.expenseCredit,
    expenseCredit1085: proof.expenseCreditVat,
    startingBalance1068: proof.startingBalance,
    balanceAfterSettlement: proof.balanceAfterSettlement,
    balance1068AfterReturn: proof.balanceAfterReturn,
    returnCreditMatchesSaleShipping: proof.returnCreditMatchesSaleGross,
    netsToZero: proof.netsToZero,
    settlementLine: proof.settlementLine,
    expenseLine: proof.expenseLine,
    plan,
  }
}

function proveUnclearedReturnAccountsNetToZero(batch, allRows = null, options = {}) {
  const rows = allRows || batch?.allRows || []
  const matchedIds = new Set(
    (batch?.matchedReturns || [])
      .filter((row) => row.status === 'matched')
      .map((row) => clean(row.itemOrderId))
      .filter(Boolean)
  )
  const returnRows = collectReturnRows(rows).filter((row) => matchedIds.has(clean(row.itemOrderId)))

  const commissionProofs = []
  const shippingProofs = []

  for (const row of returnRows) {
    const breakdown = buildNoonReturnFeeBreakdown(row)
    if (breakdown.commissionReversalGross >= TOLERANCE) {
      commissionProofs.push({
        itemOrderId: breakdown.itemOrderId,
        grossAmount: breakdown.commissionReversalGross,
        ...proveUnclearedCommission1067NetsToZero(breakdown.commissionReversalGross, row, batch, options),
      })
    }
    if (breakdown.fulfillmentReversalGross >= TOLERANCE) {
      shippingProofs.push({
        itemOrderId: breakdown.itemOrderId,
        grossAmount: breakdown.fulfillmentReversalGross,
        ...proveUnclearedShipping1068NetsToZero(breakdown.fulfillmentReversalGross, row, batch, options),
      })
    }
  }

  const commission1067AllNetToZero =
    commissionProofs.length === 0 || commissionProofs.every((proof) => proof.netsToZero)
  const shipping1068AllNetToZero =
    shippingProofs.length === 0 || shippingProofs.every((proof) => proof.netsToZero)

  return {
    commission1067: {
      accountCode: '1067',
      affectedItemCount: commissionProofs.length,
      allNetToZero: commission1067AllNetToZero,
      proofs: commissionProofs,
    },
    shipping1068: {
      accountCode: '1068',
      affectedItemCount: shippingProofs.length,
      allNetToZero: shipping1068AllNetToZero,
      proofs: shippingProofs,
    },
    allUnclearedAccountsNetToZero: commission1067AllNetToZero && shipping1068AllNetToZero,
  }
}

module.exports = {
  buildReturnFeeJournalLinesForRow,
  buildReturnFeePlan,
  summarizeReturnFeeReversals,
  proveUnclearedCommission1067NetsToZero,
  proveUnclearedShipping1068NetsToZero,
  proveUnclearedReturnAccountsNetToZero,
  isNoonReturnRow,
  TOLERANCE,
}
