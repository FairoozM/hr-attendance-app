import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  fetchNoonEligibleCatalogItems,
  fetchNoonHealth,
  fetchNoonProduct,
  fetchNoonProductDiagnostics,
  fetchNoonRichContentAudit,
  fetchNoonSnapshots,
  fetchNoonStockDiagnostics,
  fetchNoonStockFieldAudit,
  fetchNoonWarehouses,
  fetchNoonWhoami,
  syncNoonCatalogPricing,
  syncNoonStockForSkus,
} from '../lib/noonApi'

function prettyJson(value) {
  try {
    const seen = new WeakSet()
    return (
      JSON.stringify(
        value ?? null,
        (_key, entry) => {
          if (typeof entry === 'bigint') return entry.toString()
          if (entry && typeof entry === 'object') {
            if (seen.has(entry)) return '[Circular]'
            seen.add(entry)
          }
          return entry
        },
        2
      ) || 'null'
    )
  } catch {
    return '"[Unable to serialize response]"'
  }
}

function asRecord(value) {
  return value && typeof value === 'object' ? value : {}
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
}

function asDisplayText(value) {
  return typeof value === 'string' && value.trim() ? value : '—'
}

function formatMoney(value) {
  if (value == null || value === '') return '—'
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : String(value)
}

function formatPercent(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? `${numberValue}%` : '0%'
}

function coveragePercent(count, total) {
  if (!total) return 0
  return Math.round((Number(count || 0) / total) * 1000) / 10
}

function getCatalogIdentifierEntries(item) {
  const record = asRecord(item)
  return [
    ['partnerSku', record.partnerSku],
    ['psku', record.psku],
    ['sku', record.sku],
    ['pbarcode', record.pbarcode],
    ['barcode', record.barcode],
  ]
    .map(([type, value]) => ({ type, value: typeof value === 'string' ? value.trim() : '' }))
    .filter((entry) => entry.value)
}

function getBestCatalogIdentifier(item) {
  return getCatalogIdentifierEntries(item)[0] || null
}

function safeErrorMessage(error) {
  if (error && typeof error === 'object') {
    const body = asRecord(error.body)
    const bodyMessage =
      (typeof body.message === 'string' && body.message.trim()) ||
      (typeof body.error === 'string' && body.error.trim()) ||
      ''
    const bodyHint = typeof body.hint === 'string' && body.hint.trim() ? body.hint.trim() : ''
    if (bodyMessage) return bodyHint ? `${bodyMessage} ${bodyHint}` : bodyMessage
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim()
  }
  return 'Request failed.'
}

function StatusBadge({ ok, trueLabel = 'Ready', falseLabel = 'Not ready' }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
        ok
          ? 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30'
          : 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30'
      }`}
    >
      {ok ? trueLabel : falseLabel}
    </span>
  )
}

function CheckBadge({ ok }) {
  return (
    <span
      className={`inline-flex min-w-8 justify-center rounded-full px-2 py-1 text-xs font-bold ${
        ok
          ? 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30'
          : 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30'
      }`}
    >
      {ok ? 'Yes' : 'No'}
    </span>
  )
}

function InfoCard({ title, subtitle, actions, children }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function JsonPanel({ title, value, open = false }) {
  return (
    <details
      open={open}
      className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-200"
    >
      <summary className="cursor-pointer list-none font-semibold text-slate-200">{title}</summary>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-300">
        {prettyJson(value)}
      </pre>
    </details>
  )
}

function KeyValueRow({ label, value }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="max-w-[60%] text-right text-sm text-slate-200">{value}</span>
    </div>
  )
}

export default function NoonIntegrationPage() {
  const [health, setHealth] = useState(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [healthError, setHealthError] = useState('')

  const [whoamiResult, setWhoamiResult] = useState(null)
  const [whoamiLoading, setWhoamiLoading] = useState(false)
  const [whoamiError, setWhoamiError] = useState('')

  const [partnerSku, setPartnerSku] = useState('')
  const [productResult, setProductResult] = useState(null)
  const [productLoading, setProductLoading] = useState(false)
  const [productError, setProductError] = useState('')

  const [diagnosticsResult, setDiagnosticsResult] = useState(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticsError, setDiagnosticsError] = useState('')
  const [pricingCountryCode, setPricingCountryCode] = useState('ae')
  const [catalogSearch, setCatalogSearch] = useState('')
  const [eligibleCatalogResult, setEligibleCatalogResult] = useState(null)
  const [eligibleCatalogLoading, setEligibleCatalogLoading] = useState(false)
  const [eligibleCatalogError, setEligibleCatalogError] = useState('')
  const [catalogCopyStatus, setCatalogCopyStatus] = useState('')
  const [rowDiagnostics, setRowDiagnostics] = useState({})
  const [rowDiagnosticsLoading, setRowDiagnosticsLoading] = useState({})
  const [snapshotSearch, setSnapshotSearch] = useState('')
  const [snapshotResult, setSnapshotResult] = useState(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshotError, setSnapshotError] = useState('')
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [syncError, setSyncError] = useState('')
  const [richAuditResult, setRichAuditResult] = useState(null)
  const [richAuditLoading, setRichAuditLoading] = useState(false)
  const [richAuditError, setRichAuditError] = useState('')
  const [richAuditCopyStatus, setRichAuditCopyStatus] = useState('')
  const [selectedSnapshotRow, setSelectedSnapshotRow] = useState(null)
  const [stockPartnerSku, setStockPartnerSku] = useState('AC29393')
  const [stockWarehouse, setStockWarehouse] = useState('')
  const [warehousesResult, setWarehousesResult] = useState(null)
  const [warehousesLoading, setWarehousesLoading] = useState(false)
  const [warehousesError, setWarehousesError] = useState('')
  const [stockAuditResult, setStockAuditResult] = useState(null)
  const [stockAuditLoading, setStockAuditLoading] = useState(false)
  const [stockAuditError, setStockAuditError] = useState('')
  const [stockDiagnosticsResult, setStockDiagnosticsResult] = useState(null)
  const [stockDiagnosticsLoading, setStockDiagnosticsLoading] = useState(false)
  const [stockDiagnosticsError, setStockDiagnosticsError] = useState('')
  const [stockSyncResult, setStockSyncResult] = useState(null)
  const [stockSyncLoading, setStockSyncLoading] = useState(false)
  const [stockSyncError, setStockSyncError] = useState('')

  const loadHealth = useCallback(async () => {
    setHealthLoading(true)
    setHealthError('')
    try {
      const result = await fetchNoonHealth()
      const resultRecord = asRecord(result)
      setHealth(result)
      setWhoamiResult(resultRecord.whoami ?? null)
      setWhoamiError(asStringArray(resultRecord.errors)[0] || '')
    } catch (error) {
      setHealth(null)
      setHealthError(safeErrorMessage(error))
    } finally {
      setHealthLoading(false)
    }
  }, [])

  const loadWhoami = useCallback(async () => {
    setWhoamiLoading(true)
    setWhoamiError('')
    try {
      const result = await fetchNoonWhoami()
      setWhoamiResult(result)
    } catch (error) {
      setWhoamiResult(null)
      setWhoamiError(safeErrorMessage(error))
    } finally {
      setWhoamiLoading(false)
    }
  }, [])

  const loadProduct = useCallback(async () => {
    const normalizedSku = partnerSku.trim()
    if (!normalizedSku) {
      setProductError('Enter a partner_sku first.')
      setProductResult(null)
      return
    }

    setProductLoading(true)
    setProductError('')
    try {
      const result = await fetchNoonProduct(normalizedSku)
      setProductResult(result)
    } catch (error) {
      setProductResult(null)
      setProductError(safeErrorMessage(error))
    } finally {
      setProductLoading(false)
    }
  }, [partnerSku])

  const loadDiagnostics = useCallback(async () => {
    const normalizedSku = partnerSku.trim()
    if (!normalizedSku) {
      setDiagnosticsError('Enter a partner_sku first.')
      setDiagnosticsResult(null)
      return
    }

    setDiagnosticsLoading(true)
    setDiagnosticsError('')
    try {
      const result = await fetchNoonProductDiagnostics(normalizedSku, { countryCode: pricingCountryCode })
      setDiagnosticsResult(result)
    } catch (error) {
      setDiagnosticsResult(null)
      setDiagnosticsError(safeErrorMessage(error))
    } finally {
      setDiagnosticsLoading(false)
    }
  }, [partnerSku, pricingCountryCode])

  const loadEligibleCatalog = useCallback(async () => {
    setEligibleCatalogLoading(true)
    setEligibleCatalogError('')
    setCatalogCopyStatus('')
    try {
      const result = await fetchNoonEligibleCatalogItems({
        limit: 100,
      })
      setEligibleCatalogResult(result)
    } catch (error) {
      setEligibleCatalogResult(null)
      setEligibleCatalogError(safeErrorMessage(error))
    } finally {
      setEligibleCatalogLoading(false)
    }
  }, [])

  const runCatalogItemDiagnostics = useCallback(async (item, mode = 'best') => {
    const entries = mode === 'all'
      ? getCatalogIdentifierEntries(item)
      : [getBestCatalogIdentifier(item)].filter(Boolean)

    if (!entries.length) {
      setDiagnosticsError('This catalog row has no usable identifier.')
      return
    }

    const rowKey = entries.map((entry) => `${entry.type}:${entry.value}`).join('|')
    setRowDiagnosticsLoading((current) => ({ ...current, [rowKey]: true }))
    setDiagnosticsLoading(true)
    setDiagnosticsError('')
    setDiagnosticsResult(null)

    try {
      const results = []
      for (const entry of entries) {
        const result = await fetchNoonProductDiagnostics(entry.value, { countryCode: pricingCountryCode })
        results.push({
          identifierType: entry.type,
          identifier: entry.value,
          result,
        })
      }
      const payload = {
        ok: results.some((entry) => Boolean(asRecord(entry.result).ok)),
        mode,
        testedIdentifiers: results.map((entry) => ({
          type: entry.identifierType,
          value: entry.identifier,
        })),
        results,
      }
      setPartnerSku(entries[0].value)
      setDiagnosticsResult(payload)
      setRowDiagnostics((current) => ({ ...current, [rowKey]: payload }))
    } catch (error) {
      setDiagnosticsError(safeErrorMessage(error))
    } finally {
      setDiagnosticsLoading(false)
      setRowDiagnosticsLoading((current) => ({ ...current, [rowKey]: false }))
    }
  }, [pricingCountryCode])

  const loadSnapshots = useCallback(async () => {
    setSnapshotLoading(true)
    setSnapshotError('')
    try {
      const result = await fetchNoonSnapshots({
        countryCode: pricingCountryCode,
        search: snapshotSearch,
        limit: 100,
      })
      setSnapshotResult(result)
    } catch (error) {
      setSnapshotResult(null)
      setSnapshotError(safeErrorMessage(error))
    } finally {
      setSnapshotLoading(false)
    }
  }, [pricingCountryCode, snapshotSearch])

  const runSnapshotSync = useCallback(async () => {
    setSyncLoading(true)
    setSyncError('')
    setSyncResult(null)
    try {
      const result = await syncNoonCatalogPricing({
        countryCode: pricingCountryCode,
        limit: 100,
      })
      setSyncResult(result)
      await loadSnapshots()
    } catch (error) {
      setSyncError(safeErrorMessage(error))
    } finally {
      setSyncLoading(false)
    }
  }, [loadSnapshots, pricingCountryCode])

  const loadRichAudit = useCallback(async () => {
    setRichAuditLoading(true)
    setRichAuditError('')
    setRichAuditCopyStatus('')
    try {
      const result = await fetchNoonRichContentAudit({ countryCode: pricingCountryCode })
      setRichAuditResult(result)
    } catch (error) {
      setRichAuditResult(null)
      setRichAuditError(safeErrorMessage(error))
    } finally {
      setRichAuditLoading(false)
    }
  }, [pricingCountryCode])

  const loadWarehouses = useCallback(async () => {
    setWarehousesLoading(true)
    setWarehousesError('')
    try {
      const result = await fetchNoonWarehouses({ countryCode: pricingCountryCode })
      setWarehousesResult(result)
      const warehouses = Array.isArray(asRecord(result).warehouses) ? asRecord(result).warehouses : []
      const firstCode = warehouses[0] && typeof warehouses[0].code === 'string' ? warehouses[0].code : ''
      if (firstCode && !stockWarehouse) setStockWarehouse(firstCode)
    } catch (error) {
      setWarehousesResult(null)
      setWarehousesError(safeErrorMessage(error))
    } finally {
      setWarehousesLoading(false)
    }
  }, [pricingCountryCode, stockWarehouse])

  const loadStockAudit = useCallback(async () => {
    setStockAuditLoading(true)
    setStockAuditError('')
    try {
      const result = await fetchNoonStockFieldAudit({ countryCode: pricingCountryCode })
      setStockAuditResult(result)
    } catch (error) {
      setStockAuditResult(null)
      setStockAuditError(safeErrorMessage(error))
    } finally {
      setStockAuditLoading(false)
    }
  }, [pricingCountryCode])

  const runStockDiagnostics = useCallback(async (sku = stockPartnerSku) => {
    const normalizedSku = String(sku || '').trim()
    if (!normalizedSku) {
      setStockDiagnosticsError('Enter a partner_sku first.')
      return
    }
    if (!stockWarehouse.trim()) {
      setStockDiagnosticsError('Enter or select a warehouse code first.')
      return
    }
    setStockDiagnosticsLoading(true)
    setStockDiagnosticsError('')
    try {
      const result = await fetchNoonStockDiagnostics(normalizedSku, { warehouse: stockWarehouse })
      setStockPartnerSku(normalizedSku)
      setStockDiagnosticsResult(result)
    } catch (error) {
      setStockDiagnosticsResult(null)
      setStockDiagnosticsError(safeErrorMessage(error))
    } finally {
      setStockDiagnosticsLoading(false)
    }
  }, [stockPartnerSku, stockWarehouse])

  const runVisibleStockSync = useCallback(async () => {
    if (!stockWarehouse.trim()) {
      setStockSyncError('Enter or select a warehouse code first.')
      return
    }
    const currentSnapshotRows = Array.isArray(asRecord(snapshotResult).rows) ? asRecord(snapshotResult).rows : []
    const partnerSkus = currentSnapshotRows.map((row) => row.partner_sku).filter(Boolean)
    if (!partnerSkus.length) {
      setStockSyncError('Refresh snapshots first, then sync visible SKUs.')
      return
    }
    setStockSyncLoading(true)
    setStockSyncError('')
    try {
      const result = await syncNoonStockForSkus({
        countryCode: pricingCountryCode,
        warehouse: stockWarehouse,
        partnerSkus,
      })
      setStockSyncResult(result)
      await loadSnapshots()
    } catch (error) {
      setStockSyncResult(null)
      setStockSyncError(safeErrorMessage(error))
    } finally {
      setStockSyncLoading(false)
    }
  }, [loadSnapshots, pricingCountryCode, snapshotResult, stockWarehouse])

  useEffect(() => {
    loadHealth()
  }, [loadHealth])

  const healthRecord = asRecord(health)
  const configStatus = asRecord(healthRecord.configStatus)
  const authCache = asRecord(configStatus.authCache)
  const healthErrors = asStringArray(healthRecord.errors)
  const eligibleCatalogRecord = asRecord(eligibleCatalogResult)
  const eligibleCatalogItems = Array.isArray(eligibleCatalogRecord.items) ? eligibleCatalogRecord.items : []
  const snapshotRecord = asRecord(snapshotResult)
  const snapshotRows = Array.isArray(snapshotRecord.rows) ? snapshotRecord.rows : []
  const richAuditRecord = asRecord(richAuditResult)
  const richAuditSummary = asRecord(richAuditRecord.summary)
  const richAuditConclusion = asRecord(richAuditRecord.conclusion)
  const richAuditFields = Array.isArray(richAuditRecord.fields) ? richAuditRecord.fields : []
  const richAuditSkuCoverage = Array.isArray(richAuditRecord.skuCoverage) ? richAuditRecord.skuCoverage : []
  const warehousesRecord = asRecord(warehousesResult)
  const warehouseRows = Array.isArray(warehousesRecord.warehouses) ? warehousesRecord.warehouses : []
  const stockAuditRecord = asRecord(stockAuditResult)
  const stockAuditSummary = asRecord(stockAuditRecord.summary)
  const stockAuditFields = Array.isArray(stockAuditRecord.fields) ? stockAuditRecord.fields : []
  const selectedSkuAudit = selectedSnapshotRow
    ? richAuditSkuCoverage.find((entry) => entry.partnerSku === selectedSnapshotRow.partner_sku)
    : null
  const visibleEligibleCatalogItems = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase()
    if (!q) return eligibleCatalogItems
    return eligibleCatalogItems.filter((item) => {
      const record = asRecord(item)
      const haystack = [
        record.partnerSku,
        record.sku,
        record.psku,
        record.title,
        record.pbarcode,
        record.barcode,
      ]
        .filter((value) => typeof value === 'string' && value.trim())
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [catalogSearch, eligibleCatalogItems])

  const copyVisibleCatalogJson = useCallback(async () => {
    setCatalogCopyStatus('')
    const payload = {
      copiedAt: new Date().toISOString(),
      count: visibleEligibleCatalogItems.length,
      items: visibleEligibleCatalogItems,
    }
    try {
      await navigator.clipboard.writeText(prettyJson(payload))
      setCatalogCopyStatus(`Copied ${visibleEligibleCatalogItems.length} visible catalog rows.`)
    } catch {
      setCatalogCopyStatus('Could not copy catalog JSON from this browser.')
    }
  }, [visibleEligibleCatalogItems])

  const copyRichAuditJson = useCallback(async () => {
    setRichAuditCopyStatus('')
    try {
      await navigator.clipboard.writeText(prettyJson(richAuditResult))
      setRichAuditCopyStatus('Copied rich content audit JSON.')
    } catch {
      setRichAuditCopyStatus('Could not copy rich content audit JSON from this browser.')
    }
  }, [richAuditResult])

  const configRows = useMemo(
    () => [
      {
        label: 'Enabled',
        value: <StatusBadge ok={Boolean(healthRecord.enabled)} trueLabel="Enabled" falseLabel="Disabled" />,
      },
      {
        label: 'Configured',
        value: <StatusBadge ok={Boolean(healthRecord.configured)} trueLabel="Configured" falseLabel="Incomplete" />,
      },
      {
        label: 'JSON file found',
        value: (
          <StatusBadge
            ok={Boolean(configStatus.jsonPathExists)}
            trueLabel="Found"
            falseLabel="Missing"
          />
        ),
      },
      {
        label: 'NOON_PROJECT_CODE env',
        value: configStatus.projectCodeConfigured ? 'Configured' : 'Not configured',
      },
    ],
    [configStatus, healthRecord]
  )

  return (
    <div className="mx-auto flex max-w-[120rem] flex-col gap-6 px-4 pb-16 pt-4 md:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-white/10 bg-gradient-to-br from-sky-500/10 via-transparent to-emerald-500/10 p-6 backdrop-blur-xl">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-200/80">Admin</p>
          <h1 className="mt-1 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
            Noon API Integration
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Read-only Noon partner checks for configuration, authentication, whoami, and product offer lookup.
          </p>
        </div>
        <button
          type="button"
          onClick={loadHealth}
          disabled={healthLoading}
          className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
        >
          {healthLoading ? 'Refreshing…' : 'Refresh Health'}
        </button>
      </header>

      {healthError ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {healthError}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <InfoCard title="Configuration Status" subtitle="Safe Noon env and secret-file checks only.">
          <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-2">
            {configRows.map((row) => (
              <KeyValueRow key={row.label} label={row.label} value={row.value} />
            ))}
            <KeyValueRow label="Base URL" value={asDisplayText(configStatus.baseUrl)} />
            <KeyValueRow label="User-Agent" value={asDisplayText(configStatus.userAgent)} />
            <KeyValueRow label="JSON path" value={asDisplayText(configStatus.jsonPath)} />
          </div>
          <div className="mt-4">
            <JsonPanel title="Config JSON" value={configStatus} />
          </div>
        </InfoCard>

        <InfoCard title="Authentication Status" subtitle="Backend cookie-based Noon session state.">
          <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-2">
            <KeyValueRow
              label="Health"
              value={<StatusBadge ok={Boolean(healthRecord.ok)} trueLabel="Healthy" falseLabel="Needs attention" />}
            />
            <KeyValueRow
              label="Authenticated"
              value={
                <StatusBadge
                  ok={Boolean(healthRecord.authenticated)}
                  trueLabel="Authenticated"
                  falseLabel="Not authenticated"
                />
              }
            />
            <KeyValueRow
              label="Cookie cache"
              value={
                <StatusBadge
                  ok={Boolean(authCache.cached)}
                  trueLabel="Cached"
                  falseLabel="Not cached"
                />
              }
            />
            <KeyValueRow label="Cached at" value={asDisplayText(authCache.cachedAt)} />
            <KeyValueRow label="Expires at" value={asDisplayText(authCache.expiresAt)} />
            <KeyValueRow label="Whoami projectCode" value={asDisplayText(healthRecord.whoamiProjectCode)} />
            <KeyValueRow label="Whoami partnerCode" value={asDisplayText(healthRecord.whoamiPartnerCode)} />
            <KeyValueRow
              label="default_project_code sent"
              value={String(Boolean(asRecord(configStatus.loginScopeDebug).defaultProjectCodeSent))}
            />
            <KeyValueRow
              label="Sent project code"
              value={asDisplayText(asRecord(configStatus.loginScopeDebug).projectCodeValue)}
            />
          </div>

          {healthErrors.length ? (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              {healthErrors.map((entry, index) => (
                <p key={`${entry}-${index}`}>{entry}</p>
              ))}
            </div>
          ) : null}
        </InfoCard>

        <InfoCard
          title="Whoami Result"
          subtitle="Identity response from Noon."
          actions={
            <button
              type="button"
              onClick={loadWhoami}
              disabled={whoamiLoading}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
            >
              {whoamiLoading ? 'Loading…' : 'Fetch Whoami'}
            </button>
          }
        >
          {whoamiError ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {whoamiError}
            </div>
          ) : null}
          <JsonPanel title="Whoami JSON" value={whoamiResult} open />
        </InfoCard>

        <InfoCard
          title="Eligible Catalog Items"
          subtitle="Read-only GET /api/noon/catalog/eligible-items using the current Noon session."
          actions={
            <button
              type="button"
              onClick={copyVisibleCatalogJson}
              disabled={!visibleEligibleCatalogItems.length}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
            >
              Copy Visible Catalog JSON
            </button>
          }
        >
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              type="text"
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
              placeholder="Search visible Noon catalog"
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 focus:border-sky-400/50"
            />
            <button
              type="button"
              onClick={loadEligibleCatalog}
              disabled={eligibleCatalogLoading}
              className="rounded-2xl bg-emerald-500/90 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {eligibleCatalogLoading ? 'Fetching…' : 'Fetch Eligible Catalog Items'}
            </button>
          </div>

          {catalogCopyStatus ? (
            <div className="mt-4 rounded-2xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
              {catalogCopyStatus}
            </div>
          ) : null}

          {eligibleCatalogError ? (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {eligibleCatalogError}
            </div>
          ) : null}

          {eligibleCatalogResult ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-2">
              <KeyValueRow label="Returned items" value={String(eligibleCatalogRecord.count ?? 0)} />
              <KeyValueRow label="Total extracted items" value={String(eligibleCatalogRecord.totalCount ?? 0)} />
              <KeyValueRow label="Locally filtered items" value={String(visibleEligibleCatalogItems.length)} />
              <KeyValueRow label="Noon path" value={asDisplayText(eligibleCatalogRecord.path)} />
            </div>
          ) : null}

          {visibleEligibleCatalogItems.length ? (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/20">
              <table className="min-w-full text-left text-sm text-slate-200">
                <thead className="text-xs uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Partner SKU</th>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">PSKU</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Image</th>
                    <th className="px-4 py-3">Barcode</th>
                    <th className="px-4 py-3">PBarcode</th>
                    <th className="px-4 py-3">Storage</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEligibleCatalogItems.map((item, index) => {
                    const record = asRecord(item)
                    const bestIdentifier = getBestCatalogIdentifier(record)
                    const identifierEntries = getCatalogIdentifierEntries(record)
                    const rowKey = identifierEntries.length
                      ? identifierEntries.map((entry) => `${entry.type}:${entry.value}`).join('|')
                      : `row-${index}`
                    const rowLoading = Boolean(rowDiagnosticsLoading[rowKey])
                    const rowResult = rowDiagnostics[rowKey]
                    return (
                      <tr key={`${rowKey}-${index}`} className="border-t border-white/5 align-top">
                        <td className="px-4 py-3 font-mono text-xs text-sky-200">{asDisplayText(record.partnerSku)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{asDisplayText(record.sku)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{asDisplayText(record.psku)}</td>
                        <td className="min-w-[16rem] px-4 py-3">{asDisplayText(record.title)}</td>
                        <td className="px-4 py-3">
                          {record.imageUrl ? (
                            <a
                              href={record.imageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-200 underline-offset-4 hover:underline"
                            >
                              Image
                            </a>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{asDisplayText(record.barcode)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{asDisplayText(record.pbarcode)}</td>
                        <td className="px-4 py-3">{asDisplayText(record.storageType)}</td>
                        <td className="min-w-[16rem] px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => runCatalogItemDiagnostics(record, 'best')}
                              disabled={!bestIdentifier || rowLoading}
                              className="rounded-lg bg-sky-500/90 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-400 disabled:opacity-50"
                            >
                              {rowLoading ? 'Testing…' : 'Test This Item'}
                            </button>
                            <button
                              type="button"
                              onClick={() => runCatalogItemDiagnostics(record, 'all')}
                              disabled={!identifierEntries.length || rowLoading}
                              className="rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
                            >
                              Test All IDs
                            </button>
                          </div>
                          {bestIdentifier ? (
                            <p className="mt-2 text-xs text-slate-400">
                              Best: {bestIdentifier.type} = <span className="font-mono text-slate-200">{bestIdentifier.value}</span>
                            </p>
                          ) : null}
                          <details className="mt-3 rounded-xl border border-white/10 bg-slate-950/40 p-3">
                            <summary className="cursor-pointer text-xs font-semibold text-slate-300">Raw item JSON</summary>
                            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">
                              {prettyJson(record.raw ?? record)}
                            </pre>
                          </details>
                          {rowResult ? (
                            <details className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/10 p-3">
                              <summary className="cursor-pointer text-xs font-semibold text-sky-100">Row diagnostics JSON</summary>
                              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-sky-100">
                                {prettyJson(rowResult)}
                              </pre>
                            </details>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : eligibleCatalogResult ? (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              No eligible catalog items are visible for this Noon session/project.
            </div>
          ) : null}

          <div className="mt-4">
            <JsonPanel title="Eligible Catalog JSON" value={eligibleCatalogResult} open={Boolean(eligibleCatalogResult)} />
          </div>
        </InfoCard>

        <InfoCard title="Product Offer Test" subtitle="Read-only Noon SKU lookups and diagnostics.">
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              type="text"
              value={partnerSku}
              onChange={(event) => setPartnerSku(event.target.value)}
              placeholder="Enter partner_sku"
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 focus:border-sky-400/50"
            />
            <button
              type="button"
              onClick={loadProduct}
              disabled={productLoading}
              className="rounded-2xl bg-sky-500/90 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-50"
            >
              {productLoading ? 'Fetching…' : 'Fetch Noon Product'}
            </button>
            <button
              type="button"
              onClick={loadDiagnostics}
              disabled={diagnosticsLoading}
              className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
            >
              {diagnosticsLoading ? 'Running…' : 'Run SKU Diagnostics'}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3">
            <label htmlFor="noon-pricing-country" className="text-sm font-semibold text-slate-300">
              Pricing country_code
            </label>
            <select
              id="noon-pricing-country"
              value={pricingCountryCode}
              onChange={(event) => setPricingCountryCode(event.target.value)}
              className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-semibold uppercase text-white outline-none focus:border-sky-400/50"
            >
              <option value="ae">AE</option>
              <option value="sa">SA</option>
              <option value="eg">EG</option>
            </select>
            <span className="text-xs text-slate-500">
              Pricing diagnostics send this as read-only request body data.
            </span>
          </div>

          {productError ? (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {productError}
            </div>
          ) : null}
          <div className="mt-4">
            <JsonPanel title="Product JSON" value={productResult} open={Boolean(productResult)} />
          </div>

          {diagnosticsError ? (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {diagnosticsError}
            </div>
          ) : null}
          <div className="mt-4">
            <JsonPanel title="SKU Diagnostics JSON" value={diagnosticsResult} open={Boolean(diagnosticsResult)} />
          </div>
        </InfoCard>

        <InfoCard
          title="Noon Catalog & Pricing Snapshot"
          subtitle="Stores a local read-only snapshot from Noon catalog + pricing. Does not update Noon or product master."
          actions={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runSnapshotSync}
                disabled={syncLoading}
                className="rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {syncLoading ? 'Syncing…' : `Sync ${pricingCountryCode.toUpperCase()} Catalog/Pricing`}
              </button>
              <button
                type="button"
                onClick={loadSnapshots}
                disabled={snapshotLoading}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
              >
                {snapshotLoading ? 'Refreshing…' : 'Refresh Snapshots'}
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              type="text"
              value={snapshotSearch}
              onChange={(event) => setSnapshotSearch(event.target.value)}
              placeholder="Search snapshot partner_sku, noon_sku, title, barcode"
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 focus:border-sky-400/50"
            />
            <button
              type="button"
              onClick={loadSnapshots}
              disabled={snapshotLoading}
              className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
            >
              Search
            </button>
          </div>

          {syncError ? (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {syncError}
            </div>
          ) : null}
          {snapshotError ? (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {snapshotError}
            </div>
          ) : null}

          {syncResult ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-2">
              <KeyValueRow label="Catalog items" value={String(asRecord(syncResult).totalCatalogItems ?? 0)} />
              <KeyValueRow label="Pricing requested" value={String(asRecord(syncResult).pricingRequested ?? 0)} />
              <KeyValueRow label="Pricing returned" value={String(asRecord(syncResult).pricingReturned ?? 0)} />
              <KeyValueRow label="Upserted snapshots" value={String(asRecord(syncResult).upserted ?? 0)} />
              <KeyValueRow
                label="Errors"
                value={String(Array.isArray(asRecord(syncResult).errors) ? asRecord(syncResult).errors.length : 0)}
              />
            </div>
          ) : null}

          {snapshotResult ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-2">
              <KeyValueRow label="Rows" value={String(snapshotRows.length)} />
              <KeyValueRow label="Total matching" value={String(snapshotRecord.total ?? 0)} />
              <KeyValueRow label="Country" value={pricingCountryCode.toUpperCase()} />
            </div>
          ) : null}

          {snapshotRows.length ? (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/20">
              <table className="min-w-full text-left text-sm text-slate-200">
                <thead className="text-xs uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3">partner_sku</th>
                    <th className="px-4 py-3">noon_sku</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">MSRP</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Pricing Status</th>
                    <th className="px-4 py-3">Storage</th>
                    <th className="px-4 py-3">Last Synced</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshotRows.map((row) => (
                    <tr key={`${row.partner_sku}-${row.country_code}`} className="border-t border-white/5 align-top">
                      <td className="px-4 py-3 font-mono text-xs text-sky-200">
                        <button
                          type="button"
                          onClick={() => setSelectedSnapshotRow(row)}
                          className="text-left underline-offset-4 hover:underline"
                        >
                          {asDisplayText(row.partner_sku)}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{asDisplayText(row.noon_sku)}</td>
                      <td className="min-w-[18rem] px-4 py-3">{asDisplayText(row.title)}</td>
                      <td className="px-4 py-3">{formatMoney(row.price)}</td>
                      <td className="px-4 py-3">{formatMoney(row.msrp)}</td>
                      <td className="px-4 py-3">{row.is_active == null ? '—' : String(Boolean(row.is_active))}</td>
                      <td className="px-4 py-3">{asDisplayText(row.pricing_status_code)}</td>
                      <td className="px-4 py-3">{asDisplayText(row.storage_type)}</td>
                      <td className="px-4 py-3">{asDisplayText(row.last_synced_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : snapshotResult ? (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              No snapshot rows match the current filters.
            </div>
          ) : null}

          <div className="mt-4">
            <JsonPanel title="Last Sync Summary JSON" value={syncResult} open={Boolean(syncResult)} />
          </div>
        </InfoCard>

        <InfoCard
          title="Noon Rich Content Audit"
          subtitle="Read-only scan of snapshot raw JSON for Amazon-style content signals. No mapping or sync."
          actions={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadRichAudit}
                disabled={richAuditLoading}
                className="rounded-xl bg-sky-500/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-50"
              >
                {richAuditLoading ? 'Auditing…' : `Run ${pricingCountryCode.toUpperCase()} Audit`}
              </button>
              <button
                type="button"
                onClick={copyRichAuditJson}
                disabled={!richAuditResult}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
              >
                Copy Rich Content Audit JSON
              </button>
            </div>
          }
        >
          {richAuditError ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {richAuditError}
            </div>
          ) : null}
          {richAuditCopyStatus ? (
            <div className="rounded-2xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
              {richAuditCopyStatus}
            </div>
          ) : null}

          {richAuditResult ? (
            <>
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                {[
                  ['Total SKUs', richAuditRecord.totalRows],
                  ['Titles', richAuditSummary.titleCount],
                  ['Descriptions', richAuditSummary.descriptionCount],
                  ['Features/Bullets', Math.max(Number(richAuditSummary.featuresCount || 0), Number(richAuditSummary.bulletPointsCount || 0))],
                  ['Images', richAuditSummary.imageCount],
                  ['Brand', richAuditSummary.brandCount],
                  ['Category', richAuditSummary.categoryCount],
                  ['Weight', richAuditSummary.weightCount],
                  ['Dimensions', richAuditSummary.dimensionsCount],
                  ['Material', richAuditSummary.materialCount],
                  ['Color/Size', Math.max(Number(richAuditSummary.colorCount || 0), Number(richAuditSummary.sizeCount || 0))],
                  ['Barcode', richAuditSummary.barcodeCount],
                  ['Variations', richAuditSummary.variationCount],
                ].map(([label, count]) => (
                  <div key={label} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-white">{String(count ?? 0)}</p>
                    {label !== 'Total SKUs' ? (
                      <p className="mt-1 text-xs text-slate-400">
                        {formatPercent(coveragePercent(count, richAuditRecord.totalRows))}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-2">
                <KeyValueRow label="Enough for Amazon title?" value={<CheckBadge ok={Boolean(richAuditConclusion.enoughForAmazonTitle)} />} />
                <KeyValueRow label="Enough for Amazon bullets/features?" value={<CheckBadge ok={Boolean(richAuditConclusion.enoughForAmazonBulletsFeatures)} />} />
                <KeyValueRow label="Enough for Amazon dimensions/weight?" value={<CheckBadge ok={Boolean(richAuditConclusion.enoughForAmazonDimensionsWeight)} />} />
                <KeyValueRow label="Enough for Amazon images?" value={<CheckBadge ok={Boolean(richAuditConclusion.enoughForAmazonImages)} />} />
                <KeyValueRow label="Enough for barcode matching?" value={<CheckBadge ok={Boolean(richAuditConclusion.enoughForBarcodeMatching)} />} />
                <KeyValueRow label="Overall Amazon usefulness" value={asDisplayText(richAuditConclusion.overallAmazonUsefulness)} />
              </div>

              <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/20">
                <table className="min-w-full text-left text-sm text-slate-200">
                  <thead className="text-xs uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Group</th>
                      <th className="px-4 py-3">Field Path</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Coverage</th>
                      <th className="px-4 py-3">Sample Values</th>
                      <th className="px-4 py-3">Sample SKUs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {richAuditFields.map((field) => (
                      <tr key={`${field.source}-${field.group}-${field.path}`} className="border-t border-white/5 align-top">
                        <td className="px-4 py-3">{asDisplayText(field.group)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-sky-200">{asDisplayText(field.path)}</td>
                        <td className="px-4 py-3">{asDisplayText(field.source)}</td>
                        <td className="px-4 py-3">{field.count} / {richAuditRecord.totalRows} ({formatPercent(field.percentage)})</td>
                        <td className="min-w-[16rem] px-4 py-3 text-xs">{Array.isArray(field.sampleValues) ? field.sampleValues.join(' | ') : '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs">{Array.isArray(field.sampleSkus) ? field.sampleSkus.join(', ') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/20">
                <table className="min-w-full text-left text-sm text-slate-200">
                  <thead className="text-xs uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="px-4 py-3">SKU</th>
                      <th className="px-4 py-3">Title</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Features</th>
                      <th className="px-4 py-3">Images</th>
                      <th className="px-4 py-3">Brand</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Weight</th>
                      <th className="px-4 py-3">Dimensions</th>
                      <th className="px-4 py-3">Material</th>
                      <th className="px-4 py-3">Color/Size</th>
                      <th className="px-4 py-3">Barcode</th>
                      <th className="px-4 py-3">Variation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {richAuditSkuCoverage.slice(0, 100).map((row) => (
                      <tr key={row.partnerSku} className="border-t border-white/5 align-top">
                        <td className="px-4 py-3 font-mono text-xs text-sky-200">{asDisplayText(row.partnerSku)}</td>
                        <td className="min-w-[16rem] px-4 py-3">{asDisplayText(row.title)}</td>
                        <td className="px-4 py-3"><CheckBadge ok={row.hasDescription} /></td>
                        <td className="px-4 py-3"><CheckBadge ok={row.hasFeatures || row.hasBulletPoints} /></td>
                        <td className="px-4 py-3"><CheckBadge ok={row.hasImages} /></td>
                        <td className="px-4 py-3"><CheckBadge ok={row.hasBrand} /></td>
                        <td className="px-4 py-3"><CheckBadge ok={row.hasCategory} /></td>
                        <td className="px-4 py-3"><CheckBadge ok={row.hasWeight} /></td>
                        <td className="px-4 py-3"><CheckBadge ok={row.hasDimensions} /></td>
                        <td className="px-4 py-3"><CheckBadge ok={row.hasMaterial} /></td>
                        <td className="px-4 py-3"><CheckBadge ok={row.hasColor || row.hasSize} /></td>
                        <td className="px-4 py-3"><CheckBadge ok={row.hasBarcode} /></td>
                        <td className="px-4 py-3"><CheckBadge ok={row.hasVariation} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Run the audit after syncing snapshots to see rich content coverage.
            </div>
          )}
        </InfoCard>

        <InfoCard
          title="Noon Stock / Quantity Diagnostics"
          subtitle="Read-only warehouse and POST /v1/stock-list diagnostics. Never calls stock update APIs."
          actions={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadStockAudit}
                disabled={stockAuditLoading}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
              >
                {stockAuditLoading ? 'Scanning…' : 'Scan Snapshot Stock Fields'}
              </button>
              <button
                type="button"
                onClick={loadWarehouses}
                disabled={warehousesLoading}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
              >
                {warehousesLoading ? 'Fetching…' : 'Fetch Warehouses'}
              </button>
            </div>
          }
        >
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
            <input
              type="text"
              value={stockWarehouse}
              onChange={(event) => setStockWarehouse(event.target.value)}
              placeholder="Warehouse code required by /v1/stock-list"
              className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 focus:border-sky-400/50"
            />
            <input
              type="text"
              value={stockPartnerSku}
              onChange={(event) => setStockPartnerSku(event.target.value)}
              placeholder="Partner SKU"
              className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 focus:border-sky-400/50"
            />
            <button
              type="button"
              onClick={() => runStockDiagnostics(stockPartnerSku)}
              disabled={stockDiagnosticsLoading}
              className="rounded-2xl bg-sky-500/90 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-50"
            >
              {stockDiagnosticsLoading ? 'Testing…' : 'Test Stock'}
            </button>
          </div>

          {warehouseRows.length ? (
            <div className="mt-3">
              <label htmlFor="noon-stock-warehouse" className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Warehouse dropdown
              </label>
              <select
                id="noon-stock-warehouse"
                value={stockWarehouse}
                onChange={(event) => setStockWarehouse(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-sky-400/50"
              >
                <option value="">Select warehouse</option>
                {warehouseRows.map((warehouse) => (
                  <option key={warehouse.code} value={warehouse.code}>
                    {warehouse.code}{warehouse.name ? ` - ${warehouse.name}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runStockDiagnostics(snapshotRows[0]?.partner_sku || 'AC29393')}
              disabled={stockDiagnosticsLoading}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
            >
              Test First Snapshot SKU
            </button>
            <button
              type="button"
              onClick={() => runStockDiagnostics(selectedSnapshotRow?.partner_sku || '')}
              disabled={!selectedSnapshotRow || stockDiagnosticsLoading}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
            >
              Test Selected Snapshot Row Stock
            </button>
            <button
              type="button"
              onClick={runVisibleStockSync}
              disabled={stockSyncLoading || !snapshotRows.length}
              className="rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {stockSyncLoading ? 'Syncing…' : 'Sync Stock for Visible SKUs'}
            </button>
          </div>

          {warehousesError || stockAuditError || stockDiagnosticsError || stockSyncError ? (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {warehousesError || stockAuditError || stockDiagnosticsError || stockSyncError}
            </div>
          ) : null}

          {stockAuditResult ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-2">
              <KeyValueRow label="Rows scanned" value={String(stockAuditRecord.totalRows ?? 0)} />
              <KeyValueRow label="Stock/quantity field coverage" value={String(stockAuditSummary.stockQuantityFieldsFoundCount ?? 0)} />
              <KeyValueRow label="Warehouse field coverage" value={String(stockAuditSummary.warehouseFieldsFoundCount ?? 0)} />
            </div>
          ) : null}

          {stockAuditFields.length ? (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/20">
              <table className="min-w-full text-left text-sm text-slate-200">
                <thead className="text-xs uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Group</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Path</th>
                    <th className="px-4 py-3">Count</th>
                    <th className="px-4 py-3">Samples</th>
                    <th className="px-4 py-3">SKUs</th>
                  </tr>
                </thead>
                <tbody>
                  {stockAuditFields.map((field) => (
                    <tr key={`${field.source}-${field.path}`} className="border-t border-white/5 align-top">
                      <td className="px-4 py-3">{asDisplayText(field.group)}</td>
                      <td className="px-4 py-3">{asDisplayText(field.source)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-sky-200">{asDisplayText(field.path)}</td>
                      <td className="px-4 py-3">{String(field.count ?? 0)}</td>
                      <td className="px-4 py-3 text-xs">{Array.isArray(field.sampleValues) ? field.sampleValues.join(' | ') : '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{Array.isArray(field.sampleSkus) ? field.sampleSkus.join(', ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : stockAuditResult ? (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              No stock or warehouse fields were found in saved catalog/pricing/stock raw JSON.
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <JsonPanel title="Warehouses JSON" value={warehousesResult} open={Boolean(warehousesResult)} />
            <JsonPanel title="Stock Diagnostics JSON" value={stockDiagnosticsResult} open={Boolean(stockDiagnosticsResult)} />
            <JsonPanel title="Stock Sync Summary JSON" value={stockSyncResult} open={Boolean(stockSyncResult)} />
          </div>
        </InfoCard>
      </div>
      {selectedSnapshotRow ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-950/80 p-4 backdrop-blur">
          <div className="w-full max-w-5xl rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-200/80">Snapshot Row Details</p>
                <h2 className="mt-1 text-2xl font-bold text-white">{asDisplayText(selectedSnapshotRow.partner_sku)}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSnapshotRow(null)}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
              >
                Close
              </button>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2">
                <KeyValueRow label="partner_sku" value={asDisplayText(selectedSnapshotRow.partner_sku)} />
                <KeyValueRow label="noon_sku" value={asDisplayText(selectedSnapshotRow.noon_sku)} />
                <KeyValueRow label="psku" value={asDisplayText(selectedSnapshotRow.psku)} />
                <KeyValueRow label="title" value={asDisplayText(selectedSnapshotRow.title)} />
                <KeyValueRow label="image_url" value={asDisplayText(selectedSnapshotRow.image_url)} />
                <KeyValueRow label="barcode" value={asDisplayText(selectedSnapshotRow.barcode)} />
                <KeyValueRow label="pbarcode" value={asDisplayText(selectedSnapshotRow.pbarcode)} />
                <KeyValueRow label="storage_type" value={asDisplayText(selectedSnapshotRow.storage_type)} />
                <KeyValueRow label="price" value={formatMoney(selectedSnapshotRow.price)} />
                <KeyValueRow label="msrp" value={formatMoney(selectedSnapshotRow.msrp)} />
              </div>
              <JsonPanel
                title="Detected Rich Content Fields For This SKU"
                value={selectedSkuAudit ? selectedSkuAudit.matchedPaths : []}
                open
              />
              <JsonPanel title="Raw Catalog JSON" value={selectedSnapshotRow.raw_catalog_json} open />
              <JsonPanel title="Raw Pricing JSON" value={selectedSnapshotRow.raw_pricing_json} open />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
