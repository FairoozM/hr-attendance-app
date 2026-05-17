/** Export saved All Prices lists to Excel (.xlsx). */

import * as XLSX from 'xlsx'
import { computeEcommercePriceRow } from './allPricesEcommerceUtils'

const SHEET_NAME = 'Saved Prices'

/**
 * @param {string | null | undefined} iso
 * @param {string} [prefix]
 * @returns {string}
 */
export function sanitizeExportFilename(iso, prefix = 'saved-prices') {
  const d = new Date(iso || Date.now())
  if (Number.isNaN(d.getTime())) {
    return `${prefix}-${Date.now()}.xlsx`
  }
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
  return `${prefix}-${stamp}.xlsx`
}

/** @deprecated use sanitizeExportFilename */
export function sanitizeSavedListExportFilename(iso) {
  return sanitizeExportFilename(iso, 'saved-prices')
}

/**
 * @param {{ rates?: object, rows?: object[] }} list
 * @returns {object[]}
 */
export function buildExportRowsFromRatesAndRows(list) {
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

/** @deprecated alias */
export function buildSavedListExportRows(list) {
  return buildExportRowsFromRatesAndRows(list)
}

function writeWorkbook(exportRows, filename) {
  if (!exportRows.length) return false
  const worksheet = XLSX.utils.json_to_sheet(exportRows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, SHEET_NAME)
  XLSX.writeFile(workbook, filename)
  return true
}

/**
 * @param {{ rates?: object, rows?: object[] }} list
 * @returns {boolean}
 */
export function exportSavedListToExcel(list) {
  const exportRows = buildExportRowsFromRatesAndRows(list)
  const filename = sanitizeExportFilename(list?.updatedAt || list?.createdAt, 'saved-prices')
  return writeWorkbook(exportRows, filename)
}

/**
 * @param {{ rates?: object, rows?: object[] }} params
 * @returns {boolean}
 */
export function exportCurrentDraftToExcel({ rates, rows }) {
  const exportRows = buildExportRowsFromRatesAndRows({ rates, rows })
  const filename = sanitizeExportFilename(new Date().toISOString(), 'draft-prices')
  return writeWorkbook(exportRows, filename)
}

/** @deprecated use exportSavedListToExcel */
export const exportSavedPriceListToExcel = exportSavedListToExcel
