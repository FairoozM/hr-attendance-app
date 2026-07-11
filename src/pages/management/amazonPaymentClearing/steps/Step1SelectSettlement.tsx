import { useRef, useState } from 'react'
import { dateRangeText, dateText, LifecycleBadge, money } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

const LEGACY_KSA_SETTLEMENTS = [
  { period: '09.07.2025 – 23.07.2025', expectedTotal: 4427.15 },
  { period: '23.07.2025 – 06.08.2025', expectedTotal: 1952.84 },
  { period: '06.08.2025 – 20.08.2025', expectedTotal: 11536.19 },
  { period: '20.08.2025 – 03.09.2025', expectedTotal: 781.11 },
] as const

const LEGACY_CUSTOMER_NAME = 'Life Smile Business'

export function Step1SelectSettlement({ ctx }: { ctx: ClearingContext }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadFileName, setUploadFileName] = useState('')
  const selectedReport = ctx.reports.find(
    (row) => row.reportId === ctx.reportId || row.reportDocumentId === ctx.reportDocumentId
  )
  const isLegacyCustomer = ctx.zohoCustomerName === LEGACY_CUSTOMER_NAME
  const selectedCustomer = ctx.zohoCustomers.find((row) => row.name === ctx.zohoCustomerName)

  const onPickSettlementFile = (file: File | null | undefined) => {
    if (!file) return
    setUploadFileName(file.name)
    ctx.onUploadSettlementFile(file, false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="apc-step-stack">
      <div className="apc-callout">
        Saved settlements load instantly from the database. "Fetch Latest {ctx.marketplace} Settlement" lists Amazon
        settlement reports created in the last 90 days (Amazon API limit). "Preview Report" reuses a saved
        batch when one exists for the report; use "Refresh from Amazon" only when you need to re-fetch the raw report.
        {ctx.marketplace === 'KSA' ? (
          <>
            {' '}For 2025 legacy settlements, select <strong>Life Smile Business</strong>, upload the Seller Central
            settlement file (TSV/CSV/XLSX), and verify the settlement total in Step 2 before posting — do not paste an old
            reportId (Amazon returns NotFound for expired ReportRequestIds).
          </>
        ) : null}
      </div>

      <div className="apc-actions">
        <label className="ainv-label">
          Zoho customer
          <select
            className="ainv-input"
            value={ctx.zohoCustomerName}
            onChange={(e) => ctx.setZohoCustomerName(e.target.value)}
            disabled={ctx.previewing || ctx.reopening}
          >
            {ctx.zohoCustomers.length ? (
              ctx.zohoCustomers.map((row) => (
                <option key={row.name} value={row.name} disabled={!row.available}>
                  {row.label}
                  {!row.available ? ' (not found in Zoho)' : ''}
                </option>
              ))
            ) : (
              <>
                {ctx.marketplace === 'UAE' ? (
                  <option value="Amazon">Amazon (UAE)</option>
                ) : (
                  <>
                    <option value="KSA-Amazon">KSA-Amazon (current)</option>
                    <option value={LEGACY_CUSTOMER_NAME}>Life Smile Business (legacy 2025)</option>
                  </>
                )}
              </>
            )}
          </select>
        </label>
        {selectedCustomer && !selectedCustomer.available ? (
          <p className="apc-muted" style={{ color: 'var(--ainv-danger, #c0392b)' }}>
            Zoho customer "{selectedCustomer.name}" was not found. Check the contact name in Zoho Books.
          </p>
        ) : null}
      </div>

      {ctx.marketplace === 'KSA' && isLegacyCustomer ? (
        <div className="apc-callout">
          <strong>2025 legacy settlements (Life Smile Business)</strong> — process one at a time. Upload each
          Seller Central settlement file, then confirm the settlement total matches before posting.
          <div className="apc-table-wrap" style={{ marginTop: '0.75rem' }}>
            <table className="apc-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Period</th>
                  <th className="apc-money">Expected total (AED)</th>
                </tr>
              </thead>
              <tbody>
                {LEGACY_KSA_SETTLEMENTS.map((row, index) => (
                  <tr key={row.period}>
                    <td>{index + 1}</td>
                    <td>{row.period}</td>
                    <td className="apc-money">{money(row.expectedTotal, 'AED')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="apc-muted" style={{ marginTop: '0.5rem' }}>
            Recommended pilot order: start with #4 (781.11 SAR), then #2, #1, #3.
          </p>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept=".tsv,.txt,.csv,.xlsx,.xls,.xlsm,text/tab-separated-values,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        style={{ display: 'none' }}
        onChange={(e) => onPickSettlementFile(e.target.files?.[0])}
      />

      <div>
        <div className="apc-stage-panel__header">
          <h3 className="ainv-page__title" style={{ fontSize: '1rem' }}>Saved settlement batches</h3>
          <button className="ainv-btn ainv-btn--sm" type="button" onClick={ctx.onFetchReports} disabled={ctx.loadingBatches}>
            {ctx.loadingBatches ? 'Refreshing...' : 'Refresh list'}
          </button>
        </div>
        {ctx.savedBatches.length ? (
          <div className="apc-table-wrap apc-table-wrap--wide">
            <table className="apc-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Settlement</th>
                  <th>Range</th>
                  <th className="apc-money">Settlement Total</th>
                  <th>Zoho Customer</th>
                  <th>Matched</th>
                  <th>Blockers</th>
                  <th>Lifecycle</th>
                  <th>Zoho Reference</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ctx.savedBatches.map((batch) => (
                  <tr key={batch.batchId}>
                    <td>#{batch.batchId}</td>
                    <td>{batch.settlementId || '-'}</td>
                    <td>{dateRangeText(batch.settlementStartDate, batch.settlementEndDate)}</td>
                    <td className="apc-money">{money(batch.amazonSettlementTotal)}</td>
                    <td>{batch.zohoCustomerName || (ctx.marketplace === 'UAE' ? 'Amazon' : 'KSA-Amazon')}</td>
                    <td>{batch.matchedOrderCount}</td>
                    <td>{batch.creditNoteBlockerCount + batch.unmatchedOrderCount}</td>
                    <td><LifecycleBadge status={batch.lifecycleStatus} /></td>
                    <td>
                      {batch.postedToZoho && batch.postingReference ? (
                        <code className="apc-ref">{batch.postingReference}</code>
                      ) : (
                        <span className="apc-muted">-</span>
                      )}
                    </td>
                    <td>{dateText(batch.createdAt)}</td>
                    <td>
                      <button
                        className="ainv-btn ainv-btn--sm"
                        type="button"
                        onClick={() => ctx.onOpenSavedBatch(batch.batchId)}
                        disabled={ctx.reopening}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="apc-empty">No saved settlement batches yet. Fetch and preview a report to create one.</div>
        )}
      </div>

      <div className="apc-actions">
        <label className="ainv-label">
          reportId
          <input
            className="ainv-input"
            value={ctx.reportId}
            onChange={(e) => ctx.setReportId(e.target.value)}
            placeholder="Leave blank to use latest KSA settlement"
          />
        </label>
        <label className="ainv-label">
          reportDocumentId
          <input
            className="ainv-input"
            value={ctx.reportDocumentId}
            onChange={(e) => ctx.setReportDocumentId(e.target.value)}
            placeholder="Optional direct report document ID"
          />
        </label>
        <label className="ainv-label">
          saved batchId
          <input
            className="ainv-input"
            value={ctx.batchIdToOpen}
            onChange={(e) => ctx.setBatchIdToOpen(e.target.value)}
            placeholder="Open a saved batch by ID"
          />
        </label>
        <div className="apc-button-row">
          <button className="ainv-btn" type="button" onClick={ctx.onFetchReports} disabled={ctx.loadingReports || ctx.previewing}>
            {ctx.loadingReports ? 'Fetching...' : `Fetch Latest ${ctx.marketplace} Settlement`}
          </button>
          <button
            className="ainv-btn ainv-btn--primary-sky"
            type="button"
            onClick={ctx.onPreview}
            disabled={ctx.previewing || ctx.loadingReports}
          >
            {ctx.previewing ? 'Loading...' : 'Preview Report'}
          </button>
          <button
            className={isLegacyCustomer ? 'ainv-btn ainv-btn--primary-sky' : 'ainv-btn'}
            type="button"
            disabled={ctx.previewing || ctx.loadingReports}
            onClick={() => fileInputRef.current?.click()}
            title="Import a Seller Central settlement download when Amazon reportIds are expired."
          >
            {ctx.previewing && uploadFileName ? 'Importing...' : 'Upload settlement file'}
          </button>
          {uploadFileName ? <span className="apc-muted">{uploadFileName}</span> : null}
          <button
            className="ainv-btn ainv-btn--danger"
            type="button"
            onClick={ctx.onRefreshFromAmazon}
            disabled={ctx.previewing || ctx.loadingReports}
            title="Re-fetch the raw report from Amazon and replace saved parsed rows."
          >
            Refresh from Amazon
          </button>
          <button
            className="ainv-btn"
            type="button"
            onClick={ctx.onOpenBatchId}
            disabled={ctx.reopening || ctx.previewing || !ctx.batchIdToOpen.trim()}
          >
            {ctx.reopening ? 'Opening...' : 'Open Saved Batch'}
          </button>
        </div>
      </div>

      {selectedReport ? (
        <p className="apc-muted">
          Selected report: {selectedReport.reportId || '-'} · range{' '}
          {dateRangeText(selectedReport.dataStartTime, selectedReport.dataEndTime)} · created{' '}
          {dateText(selectedReport.createdTime)}
        </p>
      ) : null}

      {ctx.reports.length ? (
        <div className="apc-table-wrap">
          <table className="apc-table">
            <thead>
              <tr>
                <th>Amazon Report Range</th>
                <th>Report ID</th>
                <th>Created</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ctx.reports.map((row) => (
                <tr key={row.reportId || row.reportDocumentId}>
                  <td>
                    <button
                      className="apc-link-button"
                      type="button"
                      onClick={() => {
                        ctx.setReportId(row.reportId || '')
                        ctx.setReportDocumentId(row.reportDocumentId || '')
                      }}
                    >
                      {dateRangeText(row.dataStartTime, row.dataEndTime)}
                    </button>
                  </td>
                  <td>{row.reportId || '-'}</td>
                  <td>{dateText(row.createdTime)}</td>
                  <td>{row.processingStatus || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
