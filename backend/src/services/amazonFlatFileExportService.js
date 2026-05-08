const ExcelJS = require('exceljs')
const { query } = require('../db')

async function exportBatchWorkbook(batchId, { approvedOnly = false } = {}) {
  const b = await query(`SELECT * FROM listing_batches WHERE id = $1`, [batchId])
  const batch = b.rows[0]
  if (!batch) return null
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(batch.workbook_data)
  const ws =
    workbook.getWorksheet(batch.template_sheet_name) ||
    workbook.worksheets.find((sheet) => /^template$/i.test(sheet.name)) ||
    workbook.worksheets[0]
  if (!ws) throw new Error('Template sheet not found in stored workbook')

  const columns = batch.detected_columns || []
  const params = [batchId]
  let where = 'batch_id = $1'
  if (approvedOnly) where += ` AND status IN ('Approved','Saved','Exported')`
  const rows = await query(`SELECT * FROM listing_batch_rows WHERE ${where} ORDER BY row_index ASC`, params)
  for (const row of rows.rows) {
    const values = row.current_values || {}
    for (const col of columns) {
      if (!col?.colNumber || !col.key) continue
      if (!Object.prototype.hasOwnProperty.call(values, col.key)) continue
      const cell = ws.getRow(row.sheet_row_number).getCell(col.colNumber)
      cell.value = values[col.key] == null ? '' : String(values[col.key])
    }
    await query(`UPDATE listing_batch_rows SET status = 'Exported', exported_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id])
  }
  await query(`UPDATE listing_batches SET status = 'Exported', exported_at = NOW(), updated_at = NOW() WHERE id = $1`, [batchId])
  const buffer = await workbook.xlsx.writeBuffer()
  const base = String(batch.original_filename || `amazon-flat-file-${batchId}.xlsx`).replace(/\.(xlsm|xlsx|xls)$/i, '')
  return {
    buffer: Buffer.from(buffer),
    filename: `${base}-completed.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
}

module.exports = {
  exportBatchWorkbook,
}
