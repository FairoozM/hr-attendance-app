import * as XLSX from 'xlsx'
import type { InfluencerContractPaymentRow } from './influencerPaymentsRoiUtils'

export function exportPaymentsRoiXlsx(rows: InfluencerContractPaymentRow[], filename?: string): void {
  const sheetRows = rows.map((row) => ({
    Influencer: row.influencerName,
    Handle: row.influencerHandle,
    Contract: row.contractLabel,
    'Contract Cost (AED)': row.contractCost,
    'Amount Paid (AED)': row.amountPaid,
    'Amount Outstanding (AED)': row.hasPersistedPayment ? row.amountOutstanding : '',
    'Payment Status': row.effectiveStatus,
    'Stored Status': row.storedPaymentStatus || 'Untracked',
    'Due Date': row.dueDate || '',
    'Payment Date': row.paymentDate || '',
    Invoice: row.invoiceReference || '',
    'Sales (AED)': row.salesAed,
    'Net Profit (AED)': row.netProfitAed,
    'ROI (%)': row.roi,
    Notes: row.notes || '',
  }))

  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet(
    sheetRows.length ? sheetRows : [{ Info: 'No rows match the current filters' }],
  )
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Payments & ROI')
  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, filename || `influencer-payments-roi-${stamp}.xlsx`)
}
