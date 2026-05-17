/** Export saved All Prices lists to Excel (.xlsx). */

import * as XLSX from 'xlsx'
import { computeEcommercePriceRow } from './allPricesEcommerceUtils'

const SHEET_NAME = 'Saved Prices'

/**
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function sanitizeSavedListExportFilename(iso) {
  const d = new Date(iso || Date.now())
  if (Number.isNaN(d.getTime())) {
    return `saved-prices-${Date.now()}.xlsx`
  }
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
  return `saved-prices-${stamp}.xlsx`
}

/**
 * @param {{ rates?: object, rows?: object[] }} list
 * @returns {object[]}
 */
export function buildSavedListExportRows(list) {
  const rates = list?.rates && typeof list.rates === 'object' ? list.rates : {}
  return (Array.isArray(list?.rows) ? list.rows : []).map((row) => {
    const computed = computeEcommercePriceRow(row, rates)
    const purchaseNum = Number(row.purchasePrice)
    const shipNum = Number(row.shipping)
    const hasInputs =
      row.purchasePrice !== '' &&
      row.shipping !== '' &&
      Number.isFinite(purchaseNum) &&
      Number.isFinite(shipNum)
    const ok = hasInputs && !computed.denominatorInvalid

    return {
      'Item no.': row.itemNo != null ? String(row.itemNo) : '',
      'Sales price (AED)': ok ? computed.salesPrice : '',
      [`${rates.vatPct ?? 5}% VAT`]: ok ? Number(computed.vatAmount.toFixed(2)) : '',
      [`${rates.commissionPct ?? 15}% commission`]: ok ? Number(computed.commissionAmount.toFixed(2)) : '',
      [`${rates.advertisingPct ?? 15}% advertising`]: ok ? Number(computed.advertisingAmount.toFixed(2)) : '',
      Shipping: row.shipping !== '' && row.shipping != null ? Number(row.shipping) : '',
      'Purchase price': row.purchasePrice !== '' && row.purchasePrice != null ? Number(row.purchasePrice) : '',
      'Purchase + VAT + comm. + adv. + shipping': ok ? Number(computed.totalCost.toFixed(2)) : '',
      'Sales - costs (profit)': ok ? Number(computed.profit.toFixed(2)) : '',
      'Profit % of sales': ok ? Number(computed.profitPct.toFixed(2)) : '',
      'Date of prices': row.dateOfPrices != null ? String(row.dateOfPrices) : '',
    }
  })
}

/**
 * @param {{ rates?: object, rows?: object[], updatedAt?: string, createdAt?: string }} list
 * @returns {boolean} true when export started
 */
export function exportSavedPriceListToExcel(list) {
  const exportRows = buildSavedListExportRows(list)
  if (!exportRows.length) return false

  const worksheet = XLSX.utils.json_to_sheet(exportRows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, SHEET_NAME)
  const filename = sanitizeSavedListExportFilename(list?.updatedAt || list?.createdAt)
  XLSX.writeFile(workbook, filename)
  return true
}
