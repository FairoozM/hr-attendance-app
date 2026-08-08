import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteNoonFeeJournalMapping,
  fetchNoonFeeJournalMappings,
  fetchNoonZohoChartAccounts,
  saveNoonClearingAccount,
  saveNoonFeeJournalMapping,
  type NoonClearingAccount,
  type NoonFeeJournalMapping,
  type NoonPaymentClearingPreview,
} from '../../../../api/noonPaymentClearing'
import {
  SearchableZohoAccountPicker,
  type ZohoChartAccount,
} from '../../../../components/zoho/SearchableZohoAccountPicker'

const FEE_TYPE_OPTIONS = [
  'NOON_ADVERTISING_FEE',
  'ADVERTISING',
  'FULFILLMENT',
  'SHIPPING',
  'PARENT_ORDER_CHARGE',
  'ORDER_ADJUSTMENT',
  'STATEMENT_FEE',
  'OTHER',
]

function money(value: number | undefined | null) {
  const n = Number(value) || 0
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function safeError(err: unknown) {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: string }).message)
  return 'Something went wrong'
}

export function NoonFeeJournalMappingPanel({
  preview,
  onPreviewRefresh,
}: {
  preview: NoonPaymentClearingPreview
  onPreviewRefresh: () => Promise<void>
}) {
  const [accounts, setAccounts] = useState<ZohoChartAccount[]>([])
  const [mappings, setMappings] = useState<NoonFeeJournalMapping[]>([])
  const [clearingAccount, setClearingAccount] = useState<NoonClearingAccount>({
    accountId: '',
    accountName: '',
  })
  const [feeType, setFeeType] = useState('NOON_ADVERTISING_FEE')
  const [selectedFeeAccountId, setSelectedFeeAccountId] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.accountId, a])), [accounts])
  const feeLines = preview.feeJournalLines || []
  const unmappedCount = feeLines.filter((l) => l.mappingStatus === 'needs_mapping').length

  const feeTypeOptions = useMemo(() => {
    const fromLines = feeLines.map((l) => String(l.normalizedFeeType || l.feeType || '')).filter(Boolean)
    return Array.from(new Set([...FEE_TYPE_OPTIONS, ...fromLines]))
  }, [feeLines])

  const loadMappings = useCallback(async () => {
    const data = await fetchNoonFeeJournalMappings()
    setMappings(data.mappings || [])
    const clearing = data.clearingAccount || data.settings?.clearingAccount
    if (clearing) setClearingAccount(clearing)
  }, [])

  useEffect(() => {
    let alive = true
    setLoadingAccounts(true)
    fetchNoonZohoChartAccounts()
      .then((rows) => {
        if (alive) setAccounts((rows || []).filter((a) => a.isActive !== false))
      })
      .catch((err) => {
        if (alive) setError(safeError(err))
      })
      .finally(() => {
        if (alive) setLoadingAccounts(false)
      })
    loadMappings().catch((err) => {
      if (alive) setError(safeError(err))
    })
    return () => {
      alive = false
    }
  }, [loadMappings])

  async function onSaveClearingAccount(accountId: string) {
    if (!accountId) {
      setClearingAccount({ accountId: '', accountName: '' })
      return
    }
    const account = accountById.get(accountId)
    if (!account) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const saved = await saveNoonClearingAccount({
        accountId: account.accountId,
        accountName: account.accountName,
        accountCode: account.accountCode || '',
      })
      setClearingAccount(saved)
      setNotice(`Noon clearing account set to ${saved.accountName}.`)
      await onPreviewRefresh()
      await loadMappings()
    } catch (err) {
      setError(safeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onSaveMapping() {
    const account = accountById.get(selectedFeeAccountId)
    if (!account) {
      setError('Select a Zoho account for this fee type.')
      return
    }
    if (!clearingAccount.accountId) {
      setError('Configure the global Noon clearing account first.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await saveNoonFeeJournalMapping({
        id: editingId || undefined,
        normalizedFeeType: feeType,
        zohoAccountId: account.accountId,
        zohoAccountName: account.accountName,
        isActive: true,
      })
      setNotice(`Saved mapping: ${feeType} → ${account.accountName}`)
      setEditingId(null)
      setSelectedFeeAccountId('')
      await loadMappings()
      await onPreviewRefresh()
    } catch (err) {
      setError(safeError(err))
    } finally {
      setBusy(false)
    }
  }

  function onEdit(mapping: NoonFeeJournalMapping) {
    setEditingId(mapping.id)
    setFeeType(mapping.normalizedFeeType)
    setSelectedFeeAccountId(mapping.zohoAccountId || mapping.debitAccountId || '')
    setNotice('')
    setError('')
  }

  async function onDelete(mapping: NoonFeeJournalMapping) {
    if (!window.confirm(`Remove mapping for ${mapping.normalizedFeeType}?`)) return
    setBusy(true)
    setError('')
    try {
      await deleteNoonFeeJournalMapping(mapping.id)
      if (editingId === mapping.id) {
        setEditingId(null)
        setSelectedFeeAccountId('')
      }
      await loadMappings()
      await onPreviewRefresh()
      setNotice(`Deleted mapping for ${mapping.normalizedFeeType}.`)
    } catch (err) {
      setError(safeError(err))
    } finally {
      setBusy(false)
    }
  }

  const selectedFeeAccount = selectedFeeAccountId ? accountById.get(selectedFeeAccountId) : null
  const sampleExpensePreview =
    selectedFeeAccount && clearingAccount.accountName
      ? {
          debit: selectedFeeAccount.accountName,
          credit: clearingAccount.accountName,
        }
      : null

  return (
    <div className="npc-step-stack">
      <div className={unmappedCount ? 'npc-alert npc-alert--error' : 'npc-alert'}>
        <strong>Zoho Chart of Accounts picker</strong> — select accounts by name. Do not type account IDs.
        Map each Noon fee type to one Zoho expense/income account. The counter account is always the configured
        Noon clearing account. Journal debit/credit direction follows the signed statement amount automatically.
      </div>

      <section className="npc-card" style={{ padding: '1rem', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>Noon Clearing Account</h3>
        <p className="npc-muted">
          Global counterpart for every fee journal. Shown as <strong>Noon</strong> in accounting previews.
        </p>
        {loadingAccounts ? <p className="npc-muted">Loading Zoho chart of accounts…</p> : null}
        <SearchableZohoAccountPicker
          label="Noon Clearing Account"
          placeholder="Search Zoho Chart of Accounts..."
          accounts={accounts}
          selectedId={clearingAccount.accountId || ''}
          fallbackLabel={clearingAccount.accountName || ''}
          onSelected={(id) => {
            void onSaveClearingAccount(id)
          }}
        />
        {clearingAccount.accountId ? (
          <p className="npc-muted" style={{ marginTop: '0.5rem' }}>
            Counter account: <strong>{clearingAccount.accountName || 'Noon'}</strong>
          </p>
        ) : (
          <p className="npc-muted" style={{ marginTop: '0.5rem' }}>
            Select the Noon clearing / settlement account once. Fee mappings reuse it automatically.
          </p>
        )}
      </section>

      <section className="npc-card" style={{ padding: '1rem', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit fee mapping' : 'Add fee mapping'}</h3>
        <div className="npc-actions" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.75rem' }}>
          <label className="ainv-label">
            Fee Type
            <select
              className="ainv-input"
              value={feeType}
              onChange={(e) => setFeeType(e.target.value)}
              style={{ minWidth: '16rem' }}
            >
              {feeTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <div style={{ flex: '1 1 18rem' }}>
            <SearchableZohoAccountPicker
              label="Zoho Account"
              placeholder="Search Zoho Chart of Accounts..."
              accounts={accounts}
              selectedId={selectedFeeAccountId}
              onSelected={setSelectedFeeAccountId}
            />
          </div>
          <button type="button" className="ainv-btn ainv-btn--primary-sky" disabled={busy} onClick={onSaveMapping}>
            {editingId ? 'Update mapping' : 'Save mapping'}
          </button>
          {editingId ? (
            <button
              type="button"
              className="ainv-btn"
              disabled={busy}
              onClick={() => {
                setEditingId(null)
                setSelectedFeeAccountId('')
              }}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
        {sampleExpensePreview ? (
          <div className="npc-muted" style={{ marginTop: '0.75rem' }}>
            Accounting preview for a normal negative fee:
            <div>
              Debit: <strong>{sampleExpensePreview.debit}</strong>
            </div>
            <div>
              Credit: <strong>{sampleExpensePreview.credit}</strong>
            </div>
            <div style={{ marginTop: 4 }}>Positive credits/reversals swap debit and credit automatically.</div>
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="npc-alert npc-alert--error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="npc-alert npc-approved-panel" role="status">
          {notice}
        </div>
      ) : null}

      <h3>Saved mappings</h3>
      <div className="npc-table-wrap">
        <table className="npc-table">
          <thead>
            <tr>
              <th>Fee Type</th>
              <th>Zoho Account</th>
              <th>Counter Account</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((mapping) => (
              <tr key={mapping.id}>
                <td>{mapping.normalizedFeeType}</td>
                <td>{mapping.zohoAccountName || mapping.debitAccountName || '—'}</td>
                <td>{clearingAccount.accountName || 'Noon'}</td>
                <td>
                  <div className="npc-button-row" style={{ gap: '0.35rem' }}>
                    <button type="button" className="ainv-btn ainv-btn--sm" disabled={busy} onClick={() => onEdit(mapping)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ainv-btn ainv-btn--sm ainv-btn--danger"
                      disabled={busy}
                      onClick={() => void onDelete(mapping)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {mappings.length === 0 ? (
              <tr>
                <td colSpan={4} className="npc-empty">
                  No fee mappings saved yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3>Statement fee lines</h3>
      <div className="npc-table-wrap">
        <table className="npc-table">
          <thead>
            <tr>
              <th>Fee</th>
              <th>Amount</th>
              <th>Zoho Account</th>
              <th>Journal preview</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {feeLines.map((line) => (
              <tr key={line.lineIndex}>
                <td>
                  <strong>{String(line.displayLabel || line.feeType || '')}</strong>
                  <div className="npc-muted">{String(line.normalizedFeeType || '')}</div>
                </td>
                <td className="npc-money">
                  {money(Number(line.signedAmount != null ? line.signedAmount : line.amount) || 0)}
                </td>
                <td>{String(line.zohoAccountName || '—')}</td>
                <td>
                  {line.accountingPreview ? (
                    <div className="npc-muted">
                      Debit: {String(line.accountingPreview.debit || '—')}
                      <br />
                      Credit: {String(line.accountingPreview.credit || '—')}
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{line.mappingStatus}</td>
              </tr>
            ))}
            {feeLines.length === 0 ? (
              <tr>
                <td colSpan={5} className="npc-empty">
                  No fee journal lines on this statement.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
