const { round2, num, clean } = require('./noonPaymentClearingCategoryService')
const { normalizeGlAccount } = require('./noonPaymentClearingRowPredicates')
const { buildSettlementReference, buildEntryReference } = require('./noonPaymentClearingReferenceService')
const { getNoonPaymentClearingMarketplaceConfig } = require('./noonPaymentClearingMarketplaceConfig')
const {
  buildNoonReturnFeeBreakdown,
  buildReturnDescription,
  collectReturnRows,
  isNoonReturnRow,
  TOLERANCE,
} = require('./noonPaymentClearingReturnService')

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

function journalItem(account, debitOrCredit, amount, description) {
  return {
    debitOrCredit,
    accountId: account?.accountId,
    accountName: account?.accountName,
    accountCode: account?.accountCode,
    amount,
    description,
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
  direction = 'reversal',
}) {
  const itemOrderId = breakdown.itemOrderId
  const isCharge = direction === 'charge'
  const feeLabel = isCharge ? `${feeKind}_charge` : feeKind
  const referenceNumber = buildEntryReference(metadata, `return_${feeLabel}_settlement`, itemOrderId)
  const normalizedFeeType = isCharge
    ? 'RETURN_FULFILLMENT_CHARGE'
    : feeKind === 'commission'
      ? 'RETURN_COMMISSION_SETTLEMENT'
      : 'RETURN_FULFILLMENT_SETTLEMENT'
  const unclearedAccount = accounts[creditAccountKey]
  const description = isCharge
    ? `Noon return fee charged | ${itemOrderId} | ${clean(metadata.referenceNr)} | Gross ${gross}`
    : feeKind === 'commission'
      ? buildReturnDescription(row, metadata, 'commission')
      : `Noon fulfillment reversal | ${itemOrderId} | ${clean(metadata.referenceNr)} | Gross ${gross}`

  // A charge is the mirror of a reversal: Noon kept the fee, so undeposited drops.
  const debitAccount = isCharge ? unclearedAccount : accounts.UNDEPOSITED
  const creditAccount = isCharge ? accounts.UNDEPOSITED : unclearedAccount

  return {
    phase: 'settlement',
    direction,
    key: `return-${feeLabel}-settlement-${itemOrderId}`,
    postingGroupKey: `return_fee_settlement:${feeLabel}:${itemOrderId}`,
    rowNumber: row.rowNumber,
    itemOrderId,
    parentOrderId: breakdown.parentOrderId,
    feeType: `return_${feeLabel}_settlement`,
    normalizedFeeType,
    grossAmount: gross,
    netAmount: net,
    vatAmount: vat,
    undepositedImpact: isCharge ? round2(-gross) : gross,
    referenceNumber,
    description,
    status: 'ready',
    debit: { ...debitAccount, amount: gross },
    creditUndeposited: isCharge ? { ...accounts.UNDEPOSITED, amount: gross } : null,
    creditCommission:
      !isCharge && creditAccountKey === 'COMMISSION' ? { ...unclearedAccount, amount: gross } : null,
    creditShipping:
      !isCharge && creditAccountKey === 'SHIPPING' ? { ...unclearedAccount, amount: gross } : null,
    creditVat: null,
    primaryDebitAccount: debitAccount,
    primaryCreditAccount: creditAccount,
    journalItems: [
      journalItem(debitAccount, 'debit', gross, description),
      journalItem(creditAccount, 'credit', gross, description),
    ],
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
  direction = 'reversal',
}) {
  const itemOrderId = breakdown.itemOrderId
  const isCharge = direction === 'charge'
  const feeLabel = isCharge ? `${feeKind}_charge` : feeKind
  const referenceNumber = buildEntryReference(metadata, `return_${feeLabel}_expense_reversal`, itemOrderId)
  const normalizedFeeType = isCharge
    ? 'RETURN_FULFILLMENT_EXPENSE'
    : feeKind === 'commission'
      ? 'RETURN_COMMISSION_EXPENSE_REVERSAL'
      : 'RETURN_FULFILLMENT_EXPENSE_REVERSAL'
  const unclearedAccount = accounts[unclearedAccountKey]
  const expenseAccount = accounts[expenseAccountKey]
  const description = isCharge
    ? `Noon return fee expense | ${itemOrderId} | ${clean(metadata.referenceNr)} | Gross ${gross}`
    : feeKind === 'commission'
      ? `Noon commission expense reversal | ${itemOrderId} | ${clean(metadata.referenceNr)} | Gross ${gross}`
      : `Noon shipping expense reversal | ${itemOrderId} | ${clean(metadata.referenceNr)} | Gross ${gross}`
  const vatDescription = isCharge
    ? `Noon return fee VAT | ${itemOrderId} | ${clean(metadata.referenceNr)} | Gross ${gross}`
    : feeKind === 'commission'
      ? buildReturnDescription(row, metadata, 'vat')
      : `Noon VAT reversal | ${itemOrderId} | ${clean(metadata.referenceNr)} | Gross ${gross}`
  const hasVat = vat >= TOLERANCE

  const journalItems = isCharge
    ? [
        journalItem(expenseAccount, 'debit', hasVat ? net : gross, description),
        ...(hasVat ? [journalItem(accounts.INPUT_VAT, 'debit', vat, vatDescription)] : []),
        journalItem(unclearedAccount, 'credit', gross, description),
      ]
    : [
        journalItem(unclearedAccount, 'debit', gross, description),
        journalItem(expenseAccount, 'credit', hasVat ? net : gross, description),
        ...(hasVat ? [journalItem(accounts.INPUT_VAT, 'credit', vat, vatDescription)] : []),
      ]

  return {
    phase: 'expense_reversal',
    direction,
    key: `return-${feeLabel}-expense-${itemOrderId}`,
    postingGroupKey: `return_fee_expense_reversal:${feeLabel}:${itemOrderId}`,
    rowNumber: row.rowNumber,
    itemOrderId,
    parentOrderId: breakdown.parentOrderId,
    feeType: `return_${feeLabel}_expense_reversal`,
    normalizedFeeType,
    grossAmount: gross,
    netAmount: net,
    vatAmount: vat,
    undepositedImpact: 0,
    referenceNumber,
    description,
    vatDescription,
    status: 'ready',
    debitUncleared: isCharge ? null : { ...unclearedAccount, amount: gross },
    creditUncleared: isCharge ? { ...unclearedAccount, amount: gross } : null,
    debitExpense: isCharge ? { ...expenseAccount, amount: hasVat ? net : gross } : null,
    debitVat: isCharge && hasVat ? { ...accounts.INPUT_VAT, amount: vat } : null,
    creditExpense: isCharge ? null : { ...expenseAccount, amount: hasVat ? net : gross },
    creditVat: !isCharge && hasVat ? { ...accounts.INPUT_VAT, amount: vat } : null,
    primaryDebitAccount: isCharge ? expenseAccount : unclearedAccount,
    primaryCreditAccount: isCharge ? unclearedAccount : expenseAccount,
    journalItems,
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

  // Noon charged a return fee (return shipping, other order fees) instead of
  // giving one back. Same pair of journals, mirrored, so 1068 still nets to zero.
  if (breakdown.fulfillmentChargeGross >= TOLERANCE) {
    const gross = breakdown.fulfillmentChargeGross
    lines.push(
      buildSettlementReversalLine({
        row,
        metadata: meta,
        accounts,
        breakdown,
        feeKind: 'fulfillment',
        gross,
        net: breakdown.fulfillmentChargeNet,
        vat: breakdown.fulfillmentChargeVat,
        creditAccountKey: 'SHIPPING',
        direction: 'charge',
      }),
      buildExpenseReversalLine({
        row,
        metadata: meta,
        accounts,
        breakdown,
        feeKind: 'fulfillment',
        gross,
        net: breakdown.fulfillmentChargeNet,
        vat: breakdown.fulfillmentChargeVat,
        unclearedAccountKey: 'SHIPPING',
        expenseAccountKey: 'SHIPPING_EXPENSE',
        direction: 'charge',
      })
    )
  }

  return { breakdown, lines }
}

/**
 * Canonical debit/credit items for a return fee journal line. Preview and posting
 * both read this so they cannot disagree about direction.
 */
function returnFeeLineJournalItems(line) {
  return Array.isArray(line?.journalItems) ? line.journalItems : []
}

function appendJournalLineToZohoItems(zohoLineItems, line) {
  for (const item of returnFeeLineJournalItems(line)) {
    zohoLineItems.push({
      account_id: item.accountId,
      account_name: item.accountName,
      debit_or_credit: item.debitOrCredit,
      amount: item.amount,
      description: item.description,
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
      fulfillmentChargeGross: b.fulfillmentChargeGross,
      returnFeeResidual: b.returnFeeResidual,
      netSettlementEffect: b.netSettlementEffect,
    }
  })
}

/** Signed movement on one GL account for a line, debits positive. */
function accountMovement(line, accountCode) {
  const code = clean(accountCode)
  let total = 0
  for (const item of returnFeeLineJournalItems(line)) {
    if (clean(item.accountCode) !== code) continue
    total += item.debitOrCredit === 'debit' ? num(item.amount) : -num(item.amount)
  }
  return round2(total)
}

/**
 * Shared ledger simulation for uncleared GL after sale reclass + Phase 3 return clearing.
 * Reads the posted debit/credit items so a charge (mirrored direction) proves out too.
 */
function proveUnclearedAccountNetsToZero({
  accountCode,
  saleGrossAmount,
  settlementLine,
  expenseLine,
  assumeSaleReclassApplied = true,
}) {
  const saleGross = round2(Math.abs(num(saleGrossAmount)))
  const returnCredit = round2(-accountMovement(settlementLine, accountCode))
  const expenseDebit = accountMovement(expenseLine, accountCode)
  const startingBalance = assumeSaleReclassApplied ? 0 : saleGross
  const balanceAfterSettlement = round2(startingBalance - returnCredit)
  const balanceAfterReturn = round2(balanceAfterSettlement + expenseDebit)
  return {
    accountCode,
    saleGrossAmount: saleGross,
    returnCredit,
    expenseDebit,
    expenseCredit: round2(
      num(expenseLine?.creditExpense?.amount ?? expenseLine?.debitExpense?.amount)
    ),
    expenseCreditVat: round2(num(expenseLine?.creditVat?.amount ?? expenseLine?.debitVat?.amount)),
    startingBalance,
    balanceAfterSettlement,
    balanceAfterReturn,
    returnCreditMatchesSaleGross:
      saleGross < TOLERANCE || Math.abs(Math.abs(returnCredit) - saleGross) < TOLERANCE,
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
    (line) =>
      line.normalizedFeeType === 'RETURN_FULFILLMENT_SETTLEMENT' ||
      line.normalizedFeeType === 'RETURN_FULFILLMENT_CHARGE'
  )
  const expenseLine = (plan.expenseReversalJournalLines || []).find(
    (line) =>
      line.normalizedFeeType === 'RETURN_FULFILLMENT_EXPENSE_REVERSAL' ||
      line.normalizedFeeType === 'RETURN_FULFILLMENT_EXPENSE'
  )
  const proof = proveUnclearedAccountNetsToZero({
    accountCode: '1068',
    saleGrossAmount: saleFulfillmentFee,
    settlementLine,
    expenseLine,
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
    const shippingGross =
      breakdown.fulfillmentReversalGross >= TOLERANCE
        ? breakdown.fulfillmentReversalGross
        : breakdown.fulfillmentChargeGross
    if (shippingGross >= TOLERANCE) {
      shippingProofs.push({
        itemOrderId: breakdown.itemOrderId,
        grossAmount: shippingGross,
        direction: breakdown.fulfillmentReversalGross >= TOLERANCE ? 'reversal' : 'charge',
        ...proveUnclearedShipping1068NetsToZero(shippingGross, row, batch, options),
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
  returnFeeLineJournalItems,
  buildReturnFeePlan,
  summarizeReturnFeeReversals,
  proveUnclearedCommission1067NetsToZero,
  proveUnclearedShipping1068NetsToZero,
  proveUnclearedReturnAccountsNetToZero,
  isNoonReturnRow,
  TOLERANCE,
}
