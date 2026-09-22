/**
 * Fixed vs Flexible classification for Ecommerce Summary expenses.
 *
 * Zoho's "Fixed Expense" / "Flexible Expense" parent accounts are unused
 * (Flexible has 0 children, Fixed has 2), so the split lives here instead.
 *
 * Flexible = selling cost that moves with order volume (channel commission,
 * advertising, shipping, storage, returns, payment-gateway fees).
 * Fixed = overhead that is incurred regardless of sales (payroll, rent,
 * utilities, insurance, fleet, office).
 *
 * Accounts are matched by Zoho account_id. Names are comments only.
 * Override per environment with comma-separated ids in
 * ECOMMERCE_SUMMARY_FLEXIBLE_ACCOUNT_IDS / ECOMMERCE_SUMMARY_FIXED_ACCOUNT_IDS
 * (added on top of the lists below; the later list wins on conflict).
 */

const FLEXIBLE_ACCOUNT_IDS = [
  '4265011000000708228', // 14% Noon Commission
  '4265011000001117561', // Amazon Advertising Exp
  '4265011000000708205', // Amazon Commission Exp
  '4265011000006213841', // Amazon Expense
  '4265011000002957638', // Amazon Faulty Replacement
  '4265011000003287848', // Amazon Return Exp
  '4265011000000747608', // Amazon Shipping Exp.
  '4265011000002295201', // Amazon Storage Expense
  '4265011000012497231', // AMPSCORE UAE Service Fee
  '4265011000000708222', // Carrefour 13% Commission
  '4265011000006288937', // Carrefour Expense
  '4265011000000497085', // Courier Charges
  '4265011000012454629', // KSA Amazon Commission Exp
  '4265011000012454635', // KSA Amazon Shipping Exp
  '4265011000029081645', // KSA AMPSCORE Service Fee
  '4265011000012530775', // KSA-Amazon Advertising Exp
  '4265011000012530757', // KSA-Amazon Expense
  '4265011000012530781', // KSA-Amazon Storage Exp
  '4265011000018296025', // LS Business Advertising Exp
  '4265011000018296019', // LS Business Shipping Exp
  '4265011000000708097', // Noon Advertising Exp
  '4265011000006213835', // Noon Expense
  '4265011000003158201', // Noon Monthly Storage Fees
  '4265011000003287856', // Noon Return
  '4265011000000747614', // Noon Shipping Exp
  '4265011000003158195', // Noon Storage Fees
  '4265011000012257037', // POS-Machine Transaction Fee
  '4265011000000648121', // Stripe Fees
  '4265011000007200881', // Tabby Commission Expense
  '4265011000007120006', // Tabby Payout Fee
  '4265011000029763014', // Tamara Commission Expenses
  '4265011000000708103', // Website Advertising Exp
  '4265011000006213847', // Website Expense
  '4265011000000747626', // Website Shipping Exp
]

const FIXED_ACCOUNT_IDS = [
  '4265011000034523158', // Abdul Rehman Dev Salary A/c
  '4265011000032045153', // Aboobecker Siddiqui Salary A/c
  '4265011000034523146', // Afsal Dev Salary A/c
  '4265011000040597797', // AI Services
  '4265011000027566140', // Ali Asif Hassan
  '4265011000008039253', // Ali Shan Nizami Munshi Khan
  '4265011000033609005', // Aparna Salary A/c
  '4265011000000000409', // Bank Fees and Charges
  '4265011000015165001', // Bike 47632 Delivery
  '4265011000015215719', // Bike 47632 Depreciation Exp
  '4265011000015165445', // Bike Expense 47632 (Delivery-Bike)
  '4265011000008039273', // Choudhary Faizan Ali Shahbaz Ali
  '4265011000000497187', // Cleaning Charges
  '4265011000003071783', // DEWA Expense
  '4265011000003664043', // Employee Visa Cancellation Exp.
  '4265011000006213915', // Employee's Visa Exp
  '4265011000009042886', // Employees Salaries Expenses
  '4265011000003071817', // Fire Insurance Expense
  '4265011000014704357', // Fuel Expense 47632 (Bike)
  '4265011000015165405', // Fuel Expense 80295 (Nissan-Tiida)
  '4265011000000032023', // General Office Expense
  '4265011000011621209', // Hamdan Ali
  '4265011000003071835', // Insurance Exp (Cash Locker)
  '4265011000000747642', // Insurance Expense
  '4265011000003392769', // Internet Expense
  '4265011000000000427', // IT Support & Data Link Expense
  '4265011000008039309', // Kamran Ahmed Muhammad Munshi
  '4265011000032681933', // M-69615 Fuel Expense
  '4265011000028404003', // Margaret Sebastian
  '4265011000000000448', // Meals and Entertainment
  '4265011000003071809', // Medical Insurance Expense
  '4265011000012988039', // Mir Ali Naqi
  '4265011000008039291', // Mohammed Ajmal Sharaf KT
  '4265011000008039321', // Muhammad Abdullah Muhammad Abbas
  '4265011000008039303', // Muhammad Ajmal Nazami Hussain
  '4265011000003127409', // Office Rent Expense
  '4265011000000000460', // Other Expenses
  '4265011000020795054', // Parking
  '4265011000000000442', // Printing and Stationery
  '4265011000000000430', // Rent Expense
  '4265011000000000445', // Salaries & Wages Expenses
  '4265011000003071777', // SEWA Expense
  '4265011000000000421', // Telephone & Mobile Expense
  '4265011000000765507', // Trainess Staff Salary
  '4265011000000000418', // Travel Expense
  '4265011000012717166', // Vehicle Expense 80295 Nissan-Tiida
  '4265011000027566148', // Wafaa
  '4265011000003071795', // Warehouse Expense
  '4265011000003127403', // Warehouse Rent Expense
  '4265011000001003009', // Web Backup Maintenance
]

/** Fallback for accounts created in Zoho after this file was written. */
const FLEXIBLE_NAME_PATTERNS = [
  /commission/i,
  /advertis/i,
  /shipping/i,
  /storage/i,
  /\breturn\b/i,
  /faulty replacement/i,
  /courier/i,
  /(stripe|tabby|tamara|payout fee|transaction fee)/i,
  /(amazon|noon|carrefour|website|web store)/i,
  // FX differences come from SAR orders and settlements, so they move with volume.
  // A net gain posts negative and reduces the Flexible total.
  /exchange\s*(gain|loss)/i,
]

const FIXED_NAME_PATTERNS = [
  /salar/i,
  /\bwages?\b/i,
  /\brent\b/i,
  /(dewa|sewa|electricity|water)/i,
  /(internet|telephone|mobile)/i,
  /insurance/i,
  /visa/i,
  /(depreciation|vehicle|fuel|parking|bike)/i,
  /(cleaning|office|printing|stationery)/i,
  /(bank fees|it support|maintenance)/i,
]

function envIdList(name) {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') return []
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * @returns {Map<string, 'flexible' | 'fixed'>}
 */
function buildExpenseGroupMap() {
  const map = new Map()
  for (const id of FLEXIBLE_ACCOUNT_IDS) map.set(id, 'flexible')
  for (const id of FIXED_ACCOUNT_IDS) map.set(id, 'fixed')
  for (const id of envIdList('ECOMMERCE_SUMMARY_FLEXIBLE_ACCOUNT_IDS')) map.set(id, 'flexible')
  for (const id of envIdList('ECOMMERCE_SUMMARY_FIXED_ACCOUNT_IDS')) map.set(id, 'fixed')
  return map
}

/**
 * Classify one Expense-by-Category row.
 * Balance-sheet rows that appear in that report (inventory, prepaid rent,
 * payables, VAT) stay unclassified so they never inflate either total.
 *
 * @param {{ accountId?: string, accountName?: string }} row
 * @param {Map<string, 'flexible' | 'fixed'>} groupMap
 * @param {Set<string>} [expenseAccountIds] ids Zoho reports as P&L expenses
 * @returns {'flexible' | 'fixed' | 'unclassified'}
 */
function classifyExpenseAccount(row, groupMap, expenseAccountIds) {
  const id = String(row?.accountId || '')
  const explicit = groupMap.get(id)
  if (explicit) return explicit
  if (expenseAccountIds && !expenseAccountIds.has(id)) return 'unclassified'
  const name = String(row?.accountName || '')
  if (!name) return 'unclassified'
  if (FLEXIBLE_NAME_PATTERNS.some((re) => re.test(name))) return 'flexible'
  if (FIXED_NAME_PATTERNS.some((re) => re.test(name))) return 'fixed'
  return 'unclassified'
}

module.exports = {
  FLEXIBLE_ACCOUNT_IDS,
  FIXED_ACCOUNT_IDS,
  buildExpenseGroupMap,
  classifyExpenseAccount,
}
