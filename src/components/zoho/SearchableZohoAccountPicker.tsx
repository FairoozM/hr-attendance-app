import { useEffect, useMemo, useState } from 'react'

/** Shared Zoho Chart of Accounts row shape (Amazon + Noon payment clearing). */
export interface ZohoChartAccount {
  accountId: string
  accountName: string
  accountCode?: string
  accountType?: string
  isActive?: boolean
}

export function zohoAccountLabel(account: ZohoChartAccount) {
  return [account.accountName, account.accountCode ? `(${account.accountCode})` : '']
    .filter(Boolean)
    .join(' ')
}

/**
 * Searchable Zoho Chart of Accounts picker.
 * Extracted from Amazon KSA Payment Clearing Step7AmazonFeeJournalMapping.
 */
export function SearchableZohoAccountPicker({
  label,
  accounts,
  selectedId,
  fallbackLabel,
  placeholder,
  onSelected,
}: {
  label?: string
  accounts: ZohoChartAccount[]
  selectedId: string
  fallbackLabel?: string
  placeholder?: string
  onSelected: (accountId: string) => void
}) {
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.accountId, account])), [accounts])
  const labelById = useMemo(
    () => new Map(accounts.map((account) => [account.accountId, zohoAccountLabel(account)])),
    [accounts]
  )
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [userEditing, setUserEditing] = useState(false)
  const [hydratedSource, setHydratedSource] = useState('')

  useEffect(() => {
    if (userEditing) return
    const selectedLabel = selectedId ? labelById.get(selectedId) : ''
    const nextSource = selectedId
      ? `selected:${selectedId}:${selectedLabel || ''}`
      : fallbackLabel
        ? `fallback:${fallbackLabel}`
        : 'empty'
    if (nextSource === hydratedSource) return
    setHydratedSource(nextSource)
    setQuery(selectedLabel || fallbackLabel || '')
    if (!selectedId && fallbackLabel) {
      const cleanFallback = fallbackLabel.trim().toLowerCase()
      const exact = accounts.find(
        (account) =>
          account.accountName.trim().toLowerCase() === cleanFallback ||
          zohoAccountLabel(account).toLowerCase() === cleanFallback
      )
      if (exact) onSelected(exact.accountId)
    }
  }, [accounts, fallbackLabel, hydratedSource, labelById, onSelected, selectedId, userEditing])

  const filteredAccounts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const pool = needle
      ? accounts.filter((account) => {
          const hay = [account.accountName, account.accountCode, account.accountType, account.accountId]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          return hay.includes(needle)
        })
      : accounts
    return pool.slice(0, 30)
  }, [accounts, query])

  function chooseAccount(account: ZohoChartAccount) {
    onSelected(account.accountId)
    setQuery(zohoAccountLabel(account))
    setUserEditing(false)
    setOpen(false)
  }

  function selectSingleFilteredAccount() {
    if (selectedId || !query.trim()) return
    if (filteredAccounts.length === 1) {
      chooseAccount(filteredAccounts[0])
    }
  }

  const selected = selectedId ? accountById.get(selectedId) : null

  return (
    <div className="apc-step-stack" style={{ gap: '0.2rem', minWidth: '16rem', position: 'relative' }}>
      {label ? <span className="ainv-label">{label}</span> : null}
      <input
        className="ainv-input"
        placeholder={placeholder || `${label || 'Zoho'} account...`}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          const next = event.target.value
          setUserEditing(true)
          setQuery(next)
          onSelected('')
          setOpen(true)
        }}
        onBlur={() => {
          selectSingleFilteredAccount()
          window.setTimeout(() => setOpen(false), 120)
        }}
      />
      {open ? (
        <div
          className="apc-card"
          style={{
            position: 'absolute',
            top: label ? '4.2rem' : '2.8rem',
            left: 0,
            right: 0,
            zIndex: 20,
            maxHeight: '14rem',
            overflowY: 'auto',
            padding: '0.35rem',
            boxShadow: '0 10px 24px rgba(15, 23, 42, 0.16)',
            background: 'var(--ainv-surface, #fff)',
          }}
        >
          {filteredAccounts.length ? (
            filteredAccounts.map((account) => (
              <button
                key={account.accountId}
                type="button"
                className="ainv-btn ainv-btn--ghost"
                style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: '0.2rem' }}
                onMouseDown={(event) => {
                  event.preventDefault()
                  chooseAccount(account)
                }}
              >
                {zohoAccountLabel(account)}
                {account.accountType ? (
                  <span className="apc-muted apc-cell-sub"> {account.accountType}</span>
                ) : null}
              </button>
            ))
          ) : (
            <div className="apc-muted apc-cell-sub" style={{ padding: '0.5rem' }}>
              No matching Zoho account found.
            </div>
          )}
        </div>
      ) : null}
      {query && !selectedId ? (
        <span className="apc-muted apc-cell-sub">Select an account from the search results.</span>
      ) : null}
      {selected ? <span className="apc-muted apc-cell-sub">Selected: {selected.accountName}</span> : null}
    </div>
  )
}
