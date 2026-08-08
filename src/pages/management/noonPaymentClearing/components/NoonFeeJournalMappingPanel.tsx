import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteNoonFeeJournalMapping,
  fetchNoonFeeJournalMappings,
  fetchNoonZohoChartAccounts,
  saveNoonFeeJournalMapping,
  saveNoonInputVatSettings,
  type NoonFeeJournalMapping,
  type NoonInputVatAccount,
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
  const [undepositedName, setUndepositedName] = useState('Noon Undeposited Funds (1066)')
  const [shippingClearingName, setShippingClearingName] = useState('Noon Uncleared Shipping Charges (1068)')
  const [inputVat, setInputVat] = useState<NoonInputVatAccount | null>(null)
  const [selectedInputVatAccountId, setSelectedInputVatAccountId] = useState('')
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
  const vatSummary = preview.feeJournalVatSummary

  const feeTypeOptions = useMemo(() => {
    const fromLines = feeLines.map((l) => String(l.normalizedFeeType || l.feeType || '')).filter(Boolean)
    return Array.from(new Set([...FEE_TYPE_OPTIONS, ...fromLines]))
  }, [feeLines])

  const loadMappings = useCallback(async () => {
    const data = await fetchNoonFeeJournalMappings()
    setMappings(data.mappings || [])
    const undep = data.undepositedFundsAccount || data.settlementBridgeAccount
    if (undep?.accountName) {
      setUndepositedName(
        `${undep.accountName}${undep.accountCode ? ` (${undep.accountCode})` : ''}`
      )
    }
    if (data.unclearedShippingAccount?.accountName) {
      const s = data.unclearedShippingAccount
      setShippingClearingName(`${s.accountName}${s.accountCode ? ` (${s.accountCode})` : ''}`)
    }
    const vat = data.inputVatAccount || null
    setInputVat(vat)
    setSelectedInputVatAccountId(vat?.accountId || vat?.inputVatAccountId || '')
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

  async function onSaveInputVat() {
    const account = accountById.get(selectedInputVatAccountId)
    if (!account) {
      setError('Select the Zoho Input VAT account from the Chart of Accounts.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const saved = await saveNoonInputVatSettings({
        inputVatAccountId: account.accountId,
        inputVatAccountName: account.accountName,
        inputVatAccountCode: account.accountCode,
        vatRate: 0.05,
      })
      setInputVat(saved)
      setNotice(`Saved Input VAT account: ${account.accountName}`)
      await loadMappings()
      await onPreviewRefresh()
    } catch (err) {
      setError(safeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onSaveMapping() {
    const account = accountById.get(selectedFeeAccountId)
    if (!account) {
      setError('Select a Zoho Chart of Accounts account for this fee type.')
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
      setNotice(`Saved mapping: ${feeType} → ${account.accountName} (net expense)`)
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
  const inputVatName =
    inputVat?.accountName ||
    inputVat?.inputVatAccountName ||
    'Input VAT - All Except Basmat Goods WH (1085)'
  const isShippingFee =
    /FULFILL|SHIP|PARENT_ORDER/i.test(feeType)
  const exampleClearing = isShippingFee ? shippingClearingName : undepositedName

  return (
    <div className="npc-step-stack">
      <div className={unmappedCount ? 'npc-alert npc-alert--error' : 'npc-alert'}>
        <strong>Amazon-style Noon clearing</strong> — map each fee type to the <em>net</em> expense
        account. VAT-inclusive fees split at 5% into net expense + Input VAT. Journal counters:
        Advertising → <strong>{undepositedName}</strong>; Shipping/fulfillment →{' '}
        <strong>{shippingClearingName}</strong>. Referral stays an invoice payment to Uncleared
        Commission (1067). Noon customer is used on invoice payments only.
      </div>

      <section className="npc-card" style={{ padding: '1rem', border: '1px solid rgba(15,23,42,0.08)', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>Input VAT Account</h3>
        <p className="npc-muted" style={{ marginTop: 0 }}>
          Default: Input VAT - All Except Basmat Goods WH (1085). Confirm via CoA picker if needed.
        </p>
        {loadingAccounts ? <p className="npc-muted">Loading Zoho chart of accounts…</p> : null}
        <div className="npc-actions" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ flex: '1 1 18rem' }}>
            <SearchableZohoAccountPicker
              label="Input VAT Account"
              placeholder="Search Zoho Chart of Accounts..."
              accounts={accounts}
              selectedId={selectedInputVatAccountId}
              onSelected={setSelectedInputVatAccountId}
            />
          </div>
          <button type="button" className="ainv-btn ainv-btn--primary-sky" disabled={busy} onClick={onSaveInputVat}>
            Save Input VAT account
          </button>
        </div>
        <div className="npc-muted" style={{ marginTop: '0.75rem' }}>
          Current: <strong>{inputVatName}</strong> · VAT rate 5% (inclusive)
        </div>
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
              label="Net expense Zoho Account"
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
        {selectedFeeAccount ? (
          <div className="npc-muted" style={{ marginTop: '0.75rem' }}>
            Example VAT-inclusive negative fee:
            <div>
              Debit net expense: <strong>{selectedFeeAccount.accountName}</strong>
            </div>
            <div>
              Debit Input VAT: <strong>{inputVatName}</strong>
            </div>
            <div>
              Credit: <strong>{exampleClearing}</strong> (gross)
            </div>
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

      {vatSummary && vatSummary.vatInclusiveLineCount > 0 ? (
        <div className="npc-alert">
          Fee-journal VAT: Gross {money(vatSummary.grossInclVat)} · Net {money(vatSummary.netExpense)} ·
          Input VAT {money(vatSummary.inputVat)} ({vatSummary.vatInclusiveLineCount} lines)
        </div>
      ) : null}

      <h3>Saved mappings</h3>
      <div className="npc-table-wrap">
        <table className="npc-table">
          <thead>
            <tr>
              <th>Fee Type</th>
              <th>Net Expense Account</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((mapping) => (
              <tr key={mapping.id}>
                <td>{mapping.normalizedFeeType}</td>
                <td>{mapping.zohoAccountName || mapping.debitAccountName || '—'}</td>
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
                <td colSpan={3} className="npc-empty">
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
              <th>VAT split</th>
              <th>Accounts</th>
              <th>Journal preview</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {feeLines.map((line) => {
              const vatInclusive = Boolean(
                line.vatBreakdown?.vatInclusive && Math.abs(Number(line.inputVatAmount) || 0) >= 0.005
              )
              return (
                <tr key={line.lineIndex}>
                  <td>
                    <strong>{String(line.displayLabel || line.feeType || '')}</strong>
                    <div className="npc-muted">{String(line.normalizedFeeType || '')}</div>
                    {line.previewNote ? <div className="npc-muted">{String(line.previewNote)}</div> : null}
                  </td>
                  <td className="npc-money">
                    {vatInclusive ? (
                      <div>
                        <div>Gross incl. VAT: {money(line.grossInclVat ?? line.signedAmount)}</div>
                        <div>Net Expense: {money(line.netExpense)}</div>
                        <div>Input VAT 5%: {money(line.inputVatAmount)}</div>
                      </div>
                    ) : (
                      <div>
                        <div>Gross: {money(line.signedAmount != null ? line.signedAmount : line.amount)}</div>
                        <div className="npc-muted">No service-fee VAT split</div>
                      </div>
                    )}
                  </td>
                  <td>
                    <div>Expense: {String(line.zohoAccountName || '—')}</div>
                    {vatInclusive ? <div>VAT: {String(line.inputVatAccountName || inputVatName)}</div> : null}
                    <div>
                      Clearing:{' '}
                      {String(
                        line.accountingPreview?.clearingAccount ||
                          line.clearingAccountName ||
                          line.settlementBridgeAccountName ||
                          '—'
                      )}
                    </div>
                  </td>
                  <td>
                    {line.accountingPreview?.lines && line.accountingPreview.lines.length > 0 ? (
                      <div className="npc-muted">
                        {line.accountingPreview.lines.map((jl, i) => (
                          <div key={`${line.lineIndex}-${i}`}>
                            {String(jl.debitOrCredit || '').toUpperCase()}: {String(jl.accountName || '—')}{' '}
                            {money(jl.amount)}
                          </div>
                        ))}
                      </div>
                    ) : line.accountingPreview ? (
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
              )
            })}
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
