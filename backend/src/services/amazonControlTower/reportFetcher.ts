'use strict'

/**
 * Downloads several Amazon reports in one go: reuse a recent DONE report of the same type when allowed,
 * otherwise request it (Reports API createReport — the only Amazon POST involved), then poll every
 * pending report together and parse the delimited documents.
 *
 * Outcome per report:
 *   DONE       rows parsed
 *   CANCELLED  Amazon cancelled it — Amazon does this when there is no data for the request (rows = [])
 *   FATAL      Amazon could not produce it (e.g. not supported for the marketplace)
 *   TIMEOUT    still processing when the wait ran out
 *   ERROR      create/poll/download call failed
 */

type ReportSpec = {
  key: string
  reportType: string
  dataStartTime?: Date
  dataEndTime?: Date
  /** Reuse a DONE report created within this window (only for reports without a data window). */
  reuseMaxAgeMs?: number
}

type ReportOutcome = {
  key: string
  reportType: string
  status: 'DONE' | 'CANCELLED' | 'FATAL' | 'TIMEOUT' | 'ERROR'
  rows: Record<string, string>[]
  reportId: string | null
  reused: boolean
  amazonRequestId: string | null
  error: string | null
}

type FetcherDeps = {
  createAmazonReport: (p: any) => Promise<any>
  getAmazonReport: (id: string, o: any) => Promise<any>
  listAmazonReports: (p: any) => Promise<any>
  getAmazonReportDocument: (id: string, o: any) => Promise<any>
  downloadAmazonReportDocument: (url: string, o: any) => Promise<any>
  parseDelimitedReport: (text: string) => Record<string, string>[]
  marketplaceIdForKey: (mk: string) => string
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  pollIntervalMs?: number
  timeoutMs?: number
}

const DEFAULT_POLL_MS = 15_000
const DEFAULT_TIMEOUT_MS = 20 * 60_000

function ok(res: any): boolean {
  return res && res.status >= 200 && res.status < 300
}

function errorOf(res: any, label: string): string {
  const errs = res && res.data && Array.isArray(res.data.errors) ? res.data.errors : []
  const detail = errs.map((e: any) => `${e.code || ''} ${String(e.message || '').slice(0, 200)}`.trim()).join('; ')
  return `${label} failed (HTTP ${res ? res.status : 'n/a'})${detail ? `: ${detail}` : ''}`
}

function createReportFetcher(deps: FetcherDeps) {
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now || (() => new Date())
  const pollMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function downloadRows(mk: string, reportDocumentId: string) {
    const doc = await deps.getAmazonReportDocument(reportDocumentId, { marketplaceKey: mk })
    if (!ok(doc)) throw new Error(errorOf(doc, 'getReportDocument'))
    const dl = await deps.downloadAmazonReportDocument(doc.data && doc.data.url, { marketplaceKey: mk, compressionAlgorithm: doc.data && doc.data.compressionAlgorithm })
    if (!ok(dl)) throw new Error(`Report document download failed (HTTP ${dl ? dl.status : 'n/a'})`)
    return deps.parseDelimitedReport(String(dl.data || ''))
  }

  async function tryReuse(mk: string, marketplaceId: string, spec: ReportSpec): Promise<ReportOutcome | null> {
    if (!spec.reuseMaxAgeMs || spec.dataStartTime || spec.dataEndTime) return null
    const list = await deps.listAmazonReports({
      marketplaceKey: mk,
      reportTypes: [spec.reportType],
      processingStatuses: ['DONE'],
      marketplaceIds: [marketplaceId],
      createdSince: new Date(now().getTime() - spec.reuseMaxAgeMs).toISOString(),
      pageSize: 10,
    })
    if (!ok(list)) return null
    const reports = (Array.isArray(list.data && list.data.reports) ? list.data.reports : [])
      .filter((r: any) => r && r.reportDocumentId)
      .sort((a: any, b: any) => new Date(b.createdTime || 0).getTime() - new Date(a.createdTime || 0).getTime())
    if (!reports.length) return null
    const r = reports[0]
    const rows = await downloadRows(mk, r.reportDocumentId)
    return { key: spec.key, reportType: spec.reportType, status: 'DONE', rows, reportId: String(r.reportId || ''), reused: true, amazonRequestId: list.amazonRequestId || null, error: null }
  }

  async function fetchReports(mk: string, specs: ReportSpec[], progress?: (step: string) => void): Promise<Record<string, ReportOutcome>> {
    const marketplaceId = deps.marketplaceIdForKey(mk)
    const out: Record<string, ReportOutcome> = {}
    const pending: { spec: ReportSpec; reportId: string; requestId: string | null }[] = []

    for (const spec of specs) {
      const base = { key: spec.key, reportType: spec.reportType, rows: [], reportId: null, reused: false, amazonRequestId: null }
      try {
        progress?.(`Checking for a recent ${spec.reportType}`)
        const reused = await tryReuse(mk, marketplaceId, spec)
        if (reused) {
          out[spec.key] = reused
          continue
        }
        progress?.(`Requesting ${spec.reportType}`)
        const created = await deps.createAmazonReport({ marketplaceKey: mk, marketplaceId, reportType: spec.reportType, dataStartTime: spec.dataStartTime, dataEndTime: spec.dataEndTime })
        const reportId = created && created.data && created.data.reportId
        if (!ok(created) || !reportId) {
          out[spec.key] = { ...base, status: 'ERROR', amazonRequestId: created ? created.amazonRequestId || null : null, error: errorOf(created, `createReport ${spec.reportType}`) }
          continue
        }
        pending.push({ spec, reportId: String(reportId), requestId: created.amazonRequestId || null })
      } catch (err: any) {
        out[spec.key] = { ...base, status: 'ERROR', error: err?.message || String(err) }
      }
    }

    const started = now().getTime()
    const waiting = new Map(pending.map((p) => [p.reportId, p]))
    while (waiting.size && now().getTime() - started < timeoutMs) {
      await sleep(pollMs)
      for (const [reportId, p] of [...waiting]) {
        const base = { key: p.spec.key, reportType: p.spec.reportType, rows: [] as Record<string, string>[], reportId, reused: false, amazonRequestId: p.requestId }
        try {
          const st = await deps.getAmazonReport(reportId, { marketplaceKey: mk })
          if (!ok(st)) continue
          const status = String((st.data && st.data.processingStatus) || '').toUpperCase()
          progress?.(`${p.spec.reportType}: ${status || 'PENDING'}`)
          if (status === 'DONE') {
            waiting.delete(reportId)
            out[p.spec.key] = { ...base, status: 'DONE', rows: await downloadRows(mk, st.data.reportDocumentId), error: null }
          } else if (status === 'CANCELLED') {
            waiting.delete(reportId)
            out[p.spec.key] = { ...base, status: 'CANCELLED', error: 'Amazon cancelled the report (no data for this request)' }
          } else if (status === 'FATAL') {
            waiting.delete(reportId)
            out[p.spec.key] = { ...base, status: 'FATAL', error: 'Amazon could not generate this report (FATAL)' }
          }
        } catch (err: any) {
          waiting.delete(reportId)
          out[p.spec.key] = { ...base, status: 'ERROR', error: err?.message || String(err) }
        }
      }
    }
    for (const p of waiting.values()) {
      out[p.spec.key] = { key: p.spec.key, reportType: p.spec.reportType, status: 'TIMEOUT', rows: [], reportId: p.reportId, reused: false, amazonRequestId: p.requestId, error: `Still processing after ${Math.round(timeoutMs / 60_000)} minutes` }
    }
    return out
  }

  return { fetchReports }
}

module.exports = { createReportFetcher }
