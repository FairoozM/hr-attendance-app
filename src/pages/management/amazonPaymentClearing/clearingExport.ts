import * as XLSX from 'xlsx'
import type {
  BlockingIssue,
  ParsedSettlementRow,
  PaymentClearingPreview,
  RefundReturnCreditNoteRow,
} from '../../../api/amazonPaymentClearing'

function downloadSheet(sheetRows: Record<string, unknown>[], sheetName: string, filename: string) {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet(sheetRows.length ? sheetRows : [{ Info: 'No rows' }])
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31))
  XLSX.writeFile(workbook, filename)
}

export function exportParsedRows(rows: ParsedSettlementRow[], filename = 'amazon-ksa-parsed-rows.xlsx') {
  downloadSheet(
    rows.map((row) => ({
      '#': row.rowNumber,
      'Amazon Order ID': row.orderId,
      Category: row.category,
      'Row Type': row.rowClass,
      'Transaction Type': row.transactionType,
      'Amount Type': row.amountType,
      Description: row.amountDescription,
      Amount: row.amount,
      Currency: row.currency,
      'Settlement Date': row.settlementDate,
      Status: row.status,
      'Blocking Reason': row.blockingReason,
    })),
    'Parsed Rows',
    filename
  )
}

export function exportCreditNoteRows(
  rows: RefundReturnCreditNoteRow[],
  filename = 'amazon-ksa-missing-credit-notes.xlsx'
) {
  downloadSheet(
    rows.map((row) => ({
      'Amazon Order ID': row.orderId,
      'Row Type': row.rowClass,
      'Amazon Refund Amount': row.amazonRefundAmount,
      'Zoho Invoice': row.zohoInvoiceNumber || row.zohoInvoiceId || '',
      'Zoho Credit Note': row.zohoCreditNoteNumber || row.zohoCreditNoteId || '',
      'Credit Note Amount': row.creditNoteAmount ?? '',
      Difference: row.creditNoteDifference ?? '',
      Status: row.status,
      'Blocking Reason': row.blockingReason || '',
    })),
    'Credit Notes',
    filename
  )
}

export function exportBlockingIssues(issues: BlockingIssue[], filename = 'amazon-ksa-blocking-issues.xlsx') {
  downloadSheet(
    issues.map((issue) => ({
      Code: issue.code,
      Issue: issue.label,
      Count: issue.count,
      'Row Numbers': issue.rowNumbers.join(', '),
      'Order IDs': issue.orderIds.join(', '),
    })),
    'Blocking Issues',
    filename
  )
}

export function exportUnmatchedOrders(preview: PaymentClearingPreview, filename = 'amazon-ksa-unmatched-orders.xlsx') {
  downloadSheet(
    (preview.unmatchedOrders || []).map((row) => ({
      'Amazon Order ID': row.orderId,
      Principal: row.principalTotal,
      'Gross Amazon Total': row.grossAmazonTotal,
      'Total Fees': row.totalFees,
      'Net Balance': row.netSettlementAmount,
      Reason: row.reason,
    })),
    'Unmatched Orders',
    filename
  )
}
