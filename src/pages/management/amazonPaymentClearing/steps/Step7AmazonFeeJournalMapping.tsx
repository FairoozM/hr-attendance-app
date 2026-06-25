import { useEffect, useMemo, useState } from 'react'
import {
  fetchAmazonPaymentClearingZohoChartAccounts,
  saveKsaFeeJournalMapping,
  type AmazonFeeJournalMapping,
  type ZohoChartAccount,
} from '../../../../api/amazonPaymentClearing'
import { money, SummaryCard } from '../clearingShared'
import type { ClearingContext } from './clearingContext'

function accountLabel(account: ZohoChartAccount) {
  return [account.accountName, account.accountCode ? `(${account.accountCode})` : ''].filter(Boolean).join(' ')
}

function statusLabel(status: string) {
  if (status === 'mapped') return 'Mapped'
  if (status === 'not_required') return 'Not Required'
  if (status === 'suspense_mapping_used') return 'Suspense Mapping Used'
  if (status === 'inactive_mapping') return 'Inactive Mapping'
  return 'Needs Mapping'
}

function MappingAction({
  row,
  accounts,
  busy,
  onSave,
}: {
  row: AmazonFeeJournalMapping
  accounts: ZohoChartAccount[]
  busy: boolean
  onSave: (row: AmazonFeeJournalMapping, debit: ZohoChartAccount, credit: ZohoChartAccount) => void
}) {
  const [debitId, setDebitId] = useState(row.debitAccountId || '')
  const [creditId, setCreditId] = useState(row.creditAccountId || '')
  useEffect(() => {
    setDebitId(row.debitAccountId || '')
    setCreditId(row.creditAccountId || '')
  }, [row.debitAccountId, row.creditAccountId])

  const debit = accounts.find((account) => account.accountId === debitId)
  const credit = accounts.find((account) => account.accountId === creditId)
  const disabled = busy || !debit || !credit || row.mappingStatus === 'not_required'

  return (
    <div className="apc-button-row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
      <select className="ainv-input" value={debitId} onChange={(event) => setDebitId(event.target.value)}>
        <option value="">Debit account...</option>
        {accounts.map((account) => (
          <option key={`debit-${account.accountId}`} value={account.accountId}>{accountLabel(account)}</option>
        ))}
      </select>
      <select className="ainv-input" value={creditId} onChange={(event) => setCreditId(event.target.value)}>
        <option value="">Credit account...</option>
        {accounts.map((account) => (
          <option key={`credit-${account.accountId}`} value={account.accountId}>{accountLabel(account)}</option>
        ))}
      </select>
      <button
        className="ainv-btn ainv-btn--sm ainv-btn--primary-sky"
        type="button"
        disabled={disabled}
        onClick={() => debit && credit && onSave(row, debit, credit)}
      >
        {row.mappingRuleId ? 'Update mapping' : 'Save mapping'}
      </button>
    </div>
  )
}

export function Step7AmazonFeeJournalMapping({ ctx }: { ctx: ClearingContext }) {
  const { preview } = ctx
  const rows = preview?.nonOrderLinkedAmazonFeeMappings || []
  const [accounts, setAccounts] = useState<ZohoChartAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [savingKey, setSavingKey] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let alive = true
    setLoadingAccounts(true)
    fetchAmazonPaymentClearingZohoChartAccounts()
      .then((json) => {
        if (alive) setAccounts((json.accounts || []).filter((account) => account.isActive !== false))
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load Zoho chart of accounts.')
      })
      .finally(() => {
        if (alive) setLoadingAccounts(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const accountById = useMemo(() => new Map(accounts.map((account) => [account.accountId, account])), [accounts])
  if (!preview) return null
  const unmappedCount = rows.filter((row) => row.mappingStatus === 'needs_mapping').length
  const total = rows.reduce((sum, row) => sum + Math.abs(Number(row.totalAmount) || 0), 0)
  const reference = rows[0]?.journalPreview?.referenceNumber || '-'
  const notes = rows[0]?.journalPreview?.notes || '-'

  async function onSave(row: AmazonFeeJournalMapping, debit: ZohoChartAccount, credit: ZohoChartAccount) {
    setSavingKey(row.key)
    setError('')
    setNotice('')
    try {
      await saveKsaFeeJournalMapping({
        id: row.mappingRuleId || undefined,
        marketplace: row.marketplace || preview.marketplace,
        normalizedFeeType: row.normalizedFeeType,
        rawTransactionType: row.rawTransactionType || '',
        descriptionPattern: row.description || '',
        debitAccountName: debit.accountName,
        debitAccountId: debit.accountId,
        creditAccountName: credit.accountName,
        creditAccountId: credit.accountId,
        isActive: true,
        priority: row.mappingRuleUsed?.priority || 100,
      })
      setNotice('Mapping saved. Re-evaluating this settlement...')
      await ctx.onReloadCurrentBatch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save fee journal mapping.')
    } finally {
      setSavingKey('')
    }
  }

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
      {error ? <div className="apc-alert apc-alert--error">{error}</div> : null}
      {notice ? <div className="apc-alert">{notice}</div> : null}
      {loadingAccounts ? <p className="apc-muted">Loading Zoho chart of accounts...</p> : null}
      <div className="apc-table-wrap apc-table-wrap--wide">
        <table className="apc-table">
          <thead>
            <tr>
              <th>Fee Type</th>
              <th>Normalized Fee Type</th>
              <th>Raw Transaction Type</th>
              <th>Description</th>
              <th>Row Count</th>
              <th className="apc-money">Total Amount</th>
              <th>Suggested Zoho Debit Account</th>
              <th>Suggested Zoho Credit Account</th>
              <th>Mapping Status</th>
              <th>Last Used</th>
              <th>Action / Edit Mapping</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const debit = row.debitAccountId ? accountById.get(row.debitAccountId) : null
              const credit = row.creditAccountId ? accountById.get(row.creditAccountId) : null
              return (
                <tr key={row.key}>
                  <td>{row.feeType || '-'}</td>
                  <td>{row.normalizedFeeType || '-'}</td>
                  <td>{row.rawTransactionType || '-'}</td>
                  <td>{row.description || '-'}</td>
                  <td>{row.rowCount}</td>
                  <td className="apc-money">{money(row.totalAmount)}</td>
                  <td>{row.debitAccountName || debit?.accountName || '-'}</td>
                  <td>{row.creditAccountName || credit?.accountName || '-'}</td>
                  <td>
                    <span className={`apc-pill ${row.mappingStatus === 'needs_mapping' || row.mappingStatus === 'inactive_mapping' ? 'apc-pill--danger' : 'apc-pill--success'}`}>
                      {statusLabel(row.mappingStatus)}
                    </span>
                  </td>
                  <td>{row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : '-'}</td>
                  <td>
                    {ctx.isPosted ? (
                      <span className="apc-muted">Posted batch uses saved snapshot.</span>
                    ) : (
                      <MappingAction
                        row={row}
                        accounts={accounts}
                        busy={savingKey === row.key}
                        onSave={onSave}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
