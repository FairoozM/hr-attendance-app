import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fetchBinary, postBinary, downloadBlob } from '../../api/client'
import './WeeklyAdsReportPage.css'
import './WeeklySalesReportPage.css'
import './ZohoItemImageFetcherPage.css'

const MAX_SKUS = 1000
const FETCH_BATCH_SIZE = 25

function parseSkuText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const seen = new Set()
  const skus = []
  let duplicates = 0
  for (const sku of lines) {
    const key = sku.toLowerCase()
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    if (skus.length < MAX_SKUS) skus.push(sku)
  }
  return {
    skus,
    inputCount: lines.length,
    duplicates,
    truncated: lines.length - duplicates > MAX_SKUS,
  }
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function countStatuses(results) {
  const counts = { found: 0, notFound: 0, noImage: 0, error: 0 }
  for (const row of results) {
    if (row.status === 'Found') counts.found += 1
    else if (row.status === 'Not Found') counts.notFound += 1
    else if (row.status === 'No Image') counts.noImage += 1
    else counts.error += 1
  }
  return counts
}

function statusClass(status) {
  if (status === 'Found') return 'zif-status zif-status--found'
  if (status === 'Not Found') return 'zif-status zif-status--missing'
  if (status === 'No Image') return 'zif-status zif-status--no-image'
  return 'zif-status zif-status--error'
}

function normalizeUsage(payload) {
  if (!payload) return null
  if (payload.dailyLimit || payload.successfulCalls != null) return payload
  const zoho = payload.zoho || payload
  const day = zoho.api_usage_today || {}
  return {
    dailyLimit: day.daily_limit,
    successfulCalls: day.successful_calls,
    utcDay: day.utc_day,
    perMinuteLimit: zoho.per_minute_limit,
    countUnavailable: day.count_unavailable,
  }
}

function imageExt(contentType) {
  const ct = String(contentType || '').toLowerCase()
  if (ct.includes('png')) return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif')) return 'gif'
  return 'jpg'
}

function safeDownloadBase(value) {
  return String(value || 'item')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'item'
}

function LazyZohoImage({ row }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const objRef = useRef(null)
  const cellRef = useRef(null)
  const imageUrl = row?.imageUrl

  useEffect(() => {
    if (objRef.current) {
      URL.revokeObjectURL(objRef.current)
      objRef.current = null
    }
    setSrc('')
    setFailed(false)
    if (!imageUrl || row.status !== 'Found') return undefined

    let cancelled = false
    async function load() {
      try {
        const { blob } = await fetchBinary(imageUrl, { cache: 'default' })
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        objRef.current = url
        setSrc(url)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    const node = cellRef.current
    if (!node) return undefined
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return
        io.disconnect()
        load()
      },
      { rootMargin: '160px', threshold: 0.01 }
    )
    io.observe(node)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [imageUrl, row.status])

  useEffect(() => () => {
    if (objRef.current) URL.revokeObjectURL(objRef.current)
  }, [])

  return (
    <div className="zif-thumb" ref={cellRef}>
      {src && !failed ? <img src={src} alt={row.itemName || 'Item image'} /> : null}
      {!src && !failed && row.status === 'Found' ? <span>Loading…</span> : null}
      {(failed || row.status !== 'Found') ? <span>—</span> : null}
    </div>
  )
}

export function ZohoItemImageFetcherPage() {
  const [text, setText] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [processed, setProcessed] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState('')
  const [usage, setUsage] = useState(null)

  const parsed = useMemo(() => parseSkuText(text), [text])
  const counts = useMemo(() => countStatuses(results), [results])
  const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0

  useEffect(() => {
    let cancelled = false
    api
      .get('/api/weekly-reports/zoho-api-usage')
      .then((data) => {
        if (!cancelled) setUsage(normalizeUsage(data))
      })
      .catch(() => {
        if (!cancelled) setUsage(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleFetch = useCallback(async () => {
    const { skus } = parseSkuText(text)
    if (skus.length === 0) {
      setError('Paste at least one SKU.')
      return
    }

    setLoading(true)
    setError('')
    setResults([])
    setProcessed(0)
    setTotal(skus.length)

    try {
      const batches = chunk(skus, FETCH_BATCH_SIZE)
      const all = []
      for (const batch of batches) {
        const data = await api.post('/api/zoho/items/images/fetch', { skus: batch })
        const batchResults = Array.isArray(data?.results) ? data.results : []
        all.push(...batchResults)
        setResults([...all])
        if (data?.usage) setUsage(normalizeUsage(data.usage))
        setProcessed((prev) => Math.min(skus.length, prev + batch.length))
      }
    } catch (err) {
      setError(err?.message || 'Failed to fetch item images from Zoho.')
    } finally {
      setLoading(false)
    }
  }, [text])

  const handleExport = useCallback(async (type) => {
    if (results.length === 0) return
    setExporting(type)
    setError('')
    try {
      const path = type === 'zip'
        ? '/api/zoho/items/images/export-zip'
        : '/api/zoho/items/images/export-csv'
      const fallback = type === 'zip' ? 'zoho_item_images.zip' : 'image_fetch_results.csv'
      const { blob, filename } = await postBinary(path, { results })
      downloadBlob(blob, filename || fallback)
    } catch (err) {
      setError(err?.message || `Failed to export ${type.toUpperCase()}.`)
    } finally {
      setExporting('')
    }
  }, [results])

  return (
    <div className="war-page zif-page">
      <div className="war-page__header">
        <div>
          <h1 className="war-page__title">Zoho Item Image Fetcher</h1>
          <p className="war-page__sub">
            Paste up to 1000 SKUs, fetch product images from Zoho Inventory, then export the result list or image ZIP.
          </p>
        </div>
      </div>

      <section className="war-section">
        <div className="zif-input-head">
          <div>
            <h2 className="war-section__title">SKU Input</h2>
            <p className="zif-muted">
              One SKU per line. Empty lines and duplicates are removed before fetching.
            </p>
          </div>
          <div className="zif-input-stats">
            <span>{parsed.skus.length} unique</span>
            <span>{parsed.duplicates} duplicates</span>
            <span>{parsed.inputCount} pasted</span>
          </div>
        </div>

        <textarea
          className="zif-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'SKU-001\nSKU-002\nSKU-003'}
          rows={12}
          disabled={loading}
        />

        {parsed.truncated ? (
          <div className="wsr-callout wsr-callout--warn">
            Only the first {MAX_SKUS} unique SKUs will be fetched.
          </div>
        ) : null}

        <div className="zif-actions">
          <button
            type="button"
            className="war-btn war-btn--primary"
            onClick={handleFetch}
            disabled={loading || parsed.skus.length === 0}
          >
            {loading ? 'Fetching Images…' : 'Fetch Images'}
          </button>
          <button
            type="button"
            className="war-btn war-btn--ghost"
            onClick={() => handleExport('csv')}
            disabled={loading || exporting !== '' || results.length === 0}
          >
            {exporting === 'csv' ? 'Exporting CSV…' : 'Export Results CSV'}
          </button>
          <button
            type="button"
            className="war-btn war-btn--ghost"
            onClick={() => handleExport('zip')}
            disabled={loading || exporting !== '' || results.length === 0}
          >
            {exporting === 'zip' ? 'Preparing Images…' : 'Download All Images ZIP'}
          </button>
        </div>

        {usage ? (
          <div className="zif-usage" aria-live="polite">
            <span>Zoho API daily usage</span>
            <strong>
              {usage.successfulCalls == null ? '—' : Number(usage.successfulCalls).toLocaleString('en-US')}
              {usage.dailyLimit ? ` / ${Number(usage.dailyLimit).toLocaleString('en-US')}` : ''}
            </strong>
            {usage.perMinuteLimit ? <span>Per minute limit: {usage.perMinuteLimit}</span> : null}
            {usage.utcDay ? <span>UTC day: {usage.utcDay}</span> : null}
            {usage.countUnavailable ? <span>Usage count unavailable</span> : null}
          </div>
        ) : null}

        {loading ? (
          <div className="zif-progress" aria-live="polite">
            <div className="zif-progress__bar">
              <span style={{ width: `${progressPct}%` }} />
            </div>
            <strong>{processed} / {total}</strong> SKUs processed
          </div>
        ) : null}

        {error ? <div className="wsr-callout wsr-callout--error">{error}</div> : null}
      </section>

      <section className="war-section">
        <div className="zif-results-head">
          <h2 className="war-section__title">Results</h2>
          <div className="zif-summary">
            <span className="zif-summary__found">Found: {counts.found}</span>
            <span>Not Found: {counts.notFound}</span>
            <span>No Image: {counts.noImage}</span>
            <span>Error: {counts.error}</span>
          </div>
        </div>

        {results.length === 0 ? (
          <div className="wsr-idle">
            <p className="wsr-idle__line">Paste SKUs and click Fetch Images to populate this table.</p>
          </div>
        ) : (
          <div className="zif-table-wrap">
            <table className="zif-table">
              <thead>
                <tr>
                  <th>Item Name</th>
                  <th>Image Preview</th>
                  <th>Download</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row, index) => (
                  <tr key={`${row.itemName || row.sku || 'item'}-${row.itemId || index}-${index}`}>
                    <td className="zif-cell-strong">{row.itemName || '—'}</td>
                    <td><LazyZohoImage row={row} /></td>
                    <td>
                      {row.imageUrl ? (
                        <button
                          type="button"
                          className="zif-link-btn"
                          onClick={async () => {
                            try {
                              const { blob, contentType } = await fetchBinary(row.imageUrl)
                              const name = `${safeDownloadBase(row.itemName || row.sku || row.itemId)}.${imageExt(contentType)}`
                              downloadBlob(blob, name)
                            } catch (err) {
                              setError(err?.message || 'Failed to download image.')
                            }
                          }}
                        >
                          Download image
                        </button>
                      ) : (
                        <span className="zif-muted">{row.imageReference || row.message || '—'}</span>
                      )}
                    </td>
                    <td>
                      <span className={statusClass(row.status)}>{row.status || 'Error'}</span>
                      {row.message && row.status !== 'Found' ? <div className="zif-row-message">{row.message}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
