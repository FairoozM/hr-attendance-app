import { AmazonFeeJournalMappingTable, money, SummaryCard } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

export function Step7AmazonFeeJournalMapping({ ctx }: { ctx: ClearingContext }) {
  const { preview } = ctx
  if (!preview) return null
  const rows = preview.nonOrderLinkedAmazonFeeMappings || []
  const unmappedCount = rows.filter((row) => row.mappingStatus !== 'mapped').length
  const total = rows.reduce((sum, row) => sum + Math.abs(Number(row.totalAmount) || 0), 0)
  const reference = rows[0]?.journalPreview?.referenceNumber || '-'
  const notes = rows[0]?.journalPreview?.notes || '-'

  return (
    <div className="apc-step-stack">
      <div className={unmappedCount ? 'apc-alert apc-alert--error' : 'apc-alert'}>
        <strong>Account-level Amazon fees are posted as manual journals.</strong>{' '}
        These rows affect the settlement total but are not matched to Zoho invoices or credit notes.
      </div>
      <section className="apc-summary-grid">
        <SummaryCard label="Fee Groups" value={rows.length} />
        <SummaryCard label="Unmapped Groups" value={unmappedCount} />
        <SummaryCard label="Journal Total" value={money(total)} />
      </section>
      <div className="apc-ref-card">
        <div className="apc-ref-card__eyebrow">Manual journal preview</div>
        <div>Reference Number: <code className="apc-ref">{reference}</code></div>
        <div>Notes: {notes}</div>
      </div>
      <AmazonFeeJournalMappingTable rows={rows} />
    </div>
  )
}
