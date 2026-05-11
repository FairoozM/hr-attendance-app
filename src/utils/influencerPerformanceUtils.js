export const INFLUENCER_PLATFORMS = ['TikTok', 'Instagram', 'Snapchat', 'YouTube', 'Facebook']

export const INFLUENCER_PERFORMANCE_STATUSES = ['Active', 'Paused', 'Completed']

export function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value == null || value === '') return 0
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Parse inline metric field text: supports optional K/M suffix (e.g. 98.5K, 1.2M).
 * Falls back to {@link toNumber} for plain digit strings. Use for timeline inputs, not currency.
 */
export function parseMetricInput(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value == null || value === '') return 0
  const trimmed = String(value).trim().replace(/,/g, '')
  if (!trimmed) return 0
  const loose = /^(-?[\d.]+)\s*([kKmM]?)$/.exec(trimmed)
  if (loose) {
    const n = Number(loose[1])
    if (!Number.isFinite(n)) return 0
    const suf = String(loose[2] || '').toLowerCase()
    if (suf === 'k') return n * 1000
    if (suf === 'm') return n * 1_000_000
    return n
  }
  return toNumber(value)
}

export function calculateEngagementRate({ likes = 0, comments = 0, shares = 0, views = 0 } = {}) {
  const safeViews = toNumber(views)
  if (safeViews <= 0) return 0
  const interactions = toNumber(likes) + toNumber(comments) + toNumber(shares)
  return Number(((interactions / safeViews) * 100).toFixed(2))
}

export function formatNumber(value, options = {}) {
  const n = toNumber(value)
  if (options.currency) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: options.currency,
      maximumFractionDigits: n >= 1000 ? 0 : 2,
    }).format(n)
  }
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`
  return new Intl.NumberFormat('en-US').format(n)
}

export function addDays(dateString, days) {
  const d = isoDateSlice(dateString)
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  const [year, month, day] = d.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** ISO calendar date YYYY-MM-DD slice (safe for comparisons). */
export function isoDateSlice(value) {
  if (value == null || value === '') return ''
  return String(value).slice(0, 10)
}

/** Format YYYY-MM-DD as DD/MM/YYYY for influencer forms (display only). */
export function formatIsoDateDdMmYyyy(iso) {
  const d = isoDateSlice(iso)
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

/** Parse DD/MM/YYYY to YYYY-MM-DD; invalid calendar dates return ''. */
export function parseDdMmYyyyToIso(text) {
  const s = String(text || '').trim()
  const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return ''
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Parse ISO date as UTC noon to avoid timezone shifting calendar days. */
function parseIsoDateUtcMs(iso) {
  const d = isoDateSlice(iso)
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return NaN
  const [y, month, day] = d.split('-').map(Number)
  return Date.UTC(y, month - 1, day)
}

/** Whole calendar days from start → end (inclusive offset for matching timeline slots). */
export function daysBetweenIso(startIso, endIso) {
  const a = parseIsoDateUtcMs(startIso)
  const b = parseIsoDateUtcMs(endIso)
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN
  return Math.round((b - a) / 86_400_000)
}

export function minIsoDate(a, b) {
  const ca = isoDateSlice(a)
  const cb = isoDateSlice(b)
  if (!ca) return cb
  if (!cb) return ca
  return ca <= cb ? ca : cb
}

export function getDayNumber(startDate, date) {
  if (!startDate || !date) return null
  const offset = daysBetweenIso(startDate, date)
  if (!Number.isFinite(offset)) return null
  return offset + 1
}

function normalizeContractText(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function normalizeContractUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    const pathname = url.pathname.replace(/\/+$/, '')
    return `${hostname}${pathname}`.toLowerCase()
  } catch {
    return normalizeContractText(raw).replace(/[?#].*$/, '')
  }
}

function slugContractPart(value) {
  return normalizeContractText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'contract'
}

function isExplicitPerformanceContractId(value) {
  return String(value || '').startsWith('ip-contract::')
}

export function getVideoContractKey(record = {}) {
  const influencerId = record.influencerId || 'unknown'
  const postUrl = normalizeContractUrl(record.postUrl)
  if (postUrl) return `${influencerId}::url::${postUrl}`
  const video = normalizeContractText(record.videoTitle || record.campaignName || 'video')
  return `${influencerId}::video::${video}`
}

export function ensurePerformanceContractId(record = {}) {
  if (isExplicitPerformanceContractId(record.contractId)) return String(record.contractId)
  const signature = getVideoContractKey(record)
  const start = isoDateSlice(record.contractStartDate || record.date) || 'unknown-date'
  return `ip-contract::${slugContractPart(signature)}::${start}`
}

export function getPerformanceRecordKey(record = {}) {
  if (record.id) return `id::${record.id}`
  const cid = isExplicitPerformanceContractId(record.contractId)
    ? record.contractId
    : ensurePerformanceContractId(record)
  return `${cid}::${record.date || 'no-date'}`
}

export function dedupePerformanceRecords(records = []) {
  const byId = new Map()
  const noId = []
  records.forEach((record) => {
    const id = String(record?.id || '').trim()
    if (!id) {
      noId.push(record)
      return
    }
    const current = byId.get(id)
    if (!current) {
      byId.set(id, record)
      return
    }
    const currentTime = new Date(current.updatedAt || current.createdAt || 0).getTime()
    const nextTime = new Date(record.updatedAt || record.createdAt || 0).getTime()
    byId.set(id, nextTime >= currentTime ? record : current)
  })
  const rows = [...byId.values(), ...noId]
  const bySameExplicitDay = new Map()
  rows.forEach((record) => {
    const date = isoDateSlice(record?.date)
    const cid = isExplicitPerformanceContractId(record?.contractId) ? record.contractId : ''
    const key = cid && date ? `${cid}::${date}` : `row::${record?.id || Math.random()}`
    const current = bySameExplicitDay.get(key)
    if (!current) {
      bySameExplicitDay.set(key, record)
      return
    }
    const currentTime = new Date(current.updatedAt || current.createdAt || 0).getTime()
    const nextTime = new Date(record.updatedAt || record.createdAt || 0).getTime()
    bySameExplicitDay.set(key, nextTime >= currentTime ? record : current)
  })
  return Array.from(bySameExplicitDay.values())
}

function shouldJoinContractCluster(cluster, record, daysFallback) {
  const date = isoDateSlice(record.date)
  if (!date) return false
  const start = isoDateSlice(record.contractStartDate || record.date) || date
  const monitoringDays = Math.max(cluster.monitoringDays, toNumber(record.monitoringDays) || daysFallback)
  const earliest = minIsoDate(cluster.contractStartDate, start)
  const latest = [cluster.latestDate, date, start].filter(Boolean).sort().at(-1)
  const span = daysBetweenIso(earliest, latest)
  return Number.isFinite(span) && span <= Math.max(1, monitoringDays - 1)
}

function makeContractSeed(record, influencersById, daysFallback) {
  const signature = getVideoContractKey(record)
  const start = isoDateSlice(record.contractStartDate || record.date) || isoDateSlice(record.date)
  const contractId = isExplicitPerformanceContractId(record.contractId)
    ? record.contractId
    : ensurePerformanceContractId({ ...record, contractStartDate: start })
  return {
    id: contractId,
    naturalKey: signature,
    influencerId: record.influencerId,
    influencer: influencersById.get(String(record.influencerId)),
    platform: record.platform,
    videoTitle: record.videoTitle || record.campaignName || 'Contracted video',
    postUrl: record.postUrl || '',
    campaignName: record.campaignName || 'Campaign',
    contractStartDate: start || record.date,
    latestDate: isoDateSlice(record.date),
    monitoringDays: toNumber(record.monitoringDays) || daysFallback,
    records: [],
    totals: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      cost: 0,
      salesAed: 0,
      netProfitAed: 0,
    },
  }
}

function addRecordToContract(contract, record) {
  const assigned = { ...record, contractId: contract.id }
  contract.records.push(assigned)
  contract.contractStartDate = minIsoDate(
    contract.contractStartDate,
    record.contractStartDate || record.date,
  )
  contract.latestDate = [contract.latestDate, isoDateSlice(record.date)].filter(Boolean).sort().at(-1) || contract.latestDate
  contract.monitoringDays = Math.max(contract.monitoringDays, toNumber(record.monitoringDays) || 5)
  contract.totals.views += toNumber(record.views)
  contract.totals.likes += toNumber(record.likes)
  contract.totals.comments += toNumber(record.comments)
  contract.totals.shares += toNumber(record.shares)
  contract.totals.saves += toNumber(record.saves)
  contract.totals.cost += toNumber(record.cost)
  contract.totals.salesAed += toNumber(record.salesAed)
  contract.totals.netProfitAed += toNumber(record.netProfitAed)
}

function buildContractGroups(records = [], influencers = [], daysFallback = 5) {
  const influencersById = new Map(influencers.map((item) => [String(item.id), item]))
  const bySignature = new Map()
  const rows = dedupePerformanceRecords(records)
    .map((record) => normalizePerformanceRecord(record))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))

  rows.forEach((record) => {
    const signature = getVideoContractKey(record)
    const clusters = bySignature.get(signature) || []
    let cluster = clusters.find((item) => shouldJoinContractCluster(item, record, daysFallback))
    if (!cluster) {
      cluster = makeContractSeed(record, influencersById, daysFallback)
      clusters.push(cluster)
      bySignature.set(signature, clusters)
    }
    addRecordToContract(cluster, record)
  })

  return Array.from(bySignature.values()).flat()
}

export function getVideoContractTimelines(records = [], influencers = [], daysFallback = 5) {
  return buildContractGroups(records, influencers, daysFallback)
    .map((contract) => {
      const orderedRecords = [...contract.records].sort((a, b) =>
        String(a.date || '').localeCompare(String(b.date || '')),
      )
      const declaredStart = isoDateSlice(contract.contractStartDate) || isoDateSlice(orderedRecords[0]?.date)
      const earliestCheckIn = orderedRecords.reduce(
        (min, r) => minIsoDate(min, r.date),
        isoDateSlice(orderedRecords[0]?.date),
      )
      // Anchor window so the earliest saved check-in always maps to a column (avoids empty HUD when
      // contract start and check-in date were misaligned by a day or saved out of order).
      const startDate = minIsoDate(declaredStart, earliestCheckIn) || declaredStart
      const monitoringDays = Math.max(4, Math.min(7, toNumber(contract.monitoringDays) || daysFallback))
      const days = Array.from({ length: monitoringDays }, (_, index) => ({
        dayNumber: index + 1,
        date: addDays(startDate, index),
        record: null,
        isRecorded: false,
      }))

      orderedRecords.forEach((rec) => {
        const offset = daysBetweenIso(startDate, rec.date)
        if (!Number.isFinite(offset) || offset < 0 || offset >= monitoringDays) return
        const existing = days[offset].record
        const recTime = new Date(rec.updatedAt || rec.createdAt || 0).getTime()
        const exTime = existing ? new Date(existing.updatedAt || existing.createdAt || 0).getTime() : -Infinity
        if (!existing || recTime >= exTime) {
          days[offset].record = rec
          days[offset].isRecorded = true
        }
      })

      const latest = orderedRecords[orderedRecords.length - 1]
      return {
        ...contract,
        id: contract.id,
        contractStartDate: startDate,
        monitoringDays,
        days,
        latest,
        recordedDays: days.filter((item) => item.isRecorded).length,
        averageEngagementRate: calculateEngagementRate(contract.totals),
      }
    })
    .sort((a, b) => String(b.latest?.date || '').localeCompare(String(a.latest?.date || '')))
}

export function buildContractRows(records = [], influencers = [], rankingsByContractId = new Map(), sort = { key: 'date', direction: 'desc' }) {
  const influencersById = new Map(influencers.map((influencer) => [String(influencer.id), influencer]))
  const rows = getVideoContractTimelines(records, influencers).map((contract) => ({
    id: contract.id,
    contractId: contract.id,
    influencerId: contract.influencerId,
    influencer: contract.influencer,
    platform: contract.platform,
    postUrl: contract.postUrl,
    campaignName: contract.campaignName,
    videoTitle: contract.videoTitle,
    contractStartDate: contract.contractStartDate,
    startDate: contract.contractStartDate,
    latestDate: contract.latest?.date || contract.latestDate || contract.contractStartDate,
    date: contract.contractStartDate,
    monitoringDays: contract.monitoringDays,
    recordedDays: contract.recordedDays,
    days: contract.days,
    latest: contract.latest,
    records: contract.records,
    totals: contract.totals,
    cost: contract.totals.cost,
    views: contract.totals.views,
    likes: contract.totals.likes,
    comments: contract.totals.comments,
    shares: contract.totals.shares,
    salesAed: contract.totals.salesAed,
    netProfitAed: contract.totals.netProfitAed,
    engagementRate: contract.averageEngagementRate,
  }))

  return rows.sort((a, b) => {
    if (sort.key === 'rank') {
      const scoreA = rankingsByContractId.get(a.id)?.score ?? -1
      const scoreB = rankingsByContractId.get(b.id)?.score ?? -1
      if (scoreB !== scoreA) return sort.direction === 'asc' ? scoreB - scoreA : scoreA - scoreB
      return String(b.latestDate || '').localeCompare(String(a.latestDate || ''))
    }
    if (sort.key === 'date') {
      const aDate = a.latestDate || a.startDate
      const bDate = b.latestDate || b.startDate
      return sort.direction === 'asc'
        ? String(aDate || '').localeCompare(String(bDate || ''))
        : String(bDate || '').localeCompare(String(aDate || ''))
    }
    if (sort.key === 'influencer') {
      const aName = influencersById.get(String(a.influencerId))?.name || ''
      const bName = influencersById.get(String(b.influencerId))?.name || ''
      return sort.direction === 'asc' ? aName.localeCompare(bName) : bName.localeCompare(aName)
    }
    const valueA = a[sort.key]
    const valueB = b[sort.key]
    if (typeof valueA === 'number' || typeof valueB === 'number') {
      return sort.direction === 'asc' ? toNumber(valueA) - toNumber(valueB) : toNumber(valueB) - toNumber(valueA)
    }
    return sort.direction === 'asc'
      ? String(valueA || '').localeCompare(String(valueB || ''))
      : String(valueB || '').localeCompare(String(valueA || ''))
  })
}

const RANK_PROFIT_WEIGHT = 0.9
const RANK_ENGAGEMENT_WEIGHT = 0.1
const RANK_ENGAGEMENT_METRICS = 5

/**
 * Min–max normalize to 0–1. When all values are equal, returns 1 for every row (neutral “best”).
 */
function normalizeMinMax(values) {
  const nums = values.map((v) => toNumber(v))
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return nums.map(() => 1)
  }
  return nums.map((v) => (v - min) / (max - min))
}

/**
 * Rank video contracts: 90% net profit (AED) + 10% split across views, likes, comments, shares, cost-inverted.
 * Uses each contract's **latest** daily record for metrics (snapshot, not summed totals).
 * @returns {Map<string, { rank: number, score: number, score100: number, contractId: string, breakdown: Record<string, number> }>}
 */
export function computeContractRankings(contracts = []) {
  const out = new Map()
  if (!Array.isArray(contracts) || contracts.length === 0) return out

  const rows = contracts.map((contract) => {
    const rec = contract.latest || {}
    return {
      contractId: String(contract.id || ''),
      contract,
      views: toNumber(rec.views),
      likes: toNumber(rec.likes),
      comments: toNumber(rec.comments),
      shares: toNumber(rec.shares),
      netProfitAed: toNumber(rec.netProfitAed),
      cost: toNumber(rec.cost),
      latestDate: isoDateSlice(rec.date) || '',
    }
  })

  const normProfit = normalizeMinMax(rows.map((r) => r.netProfitAed))
  const normViews = normalizeMinMax(rows.map((r) => r.views))
  const normLikes = normalizeMinMax(rows.map((r) => r.likes))
  const normComments = normalizeMinMax(rows.map((r) => r.comments))
  const normShares = normalizeMinMax(rows.map((r) => r.shares))
  const costs = rows.map((r) => r.cost)
  const maxCost = Math.max(...costs, 0)
  const costInverted = costs.map((c) => maxCost - c)
  const normCostEff = normalizeMinMax(costInverted)

  const scored = rows.map((row, i) => {
    const engagementAvg = (
      normViews[i] +
      normLikes[i] +
      normComments[i] +
      normShares[i] +
      normCostEff[i]
    ) / RANK_ENGAGEMENT_METRICS
    const score = RANK_PROFIT_WEIGHT * normProfit[i] + RANK_ENGAGEMENT_WEIGHT * engagementAvg
    const breakdown = {
      normProfit: normProfit[i],
      normViews: normViews[i],
      normLikes: normLikes[i],
      normComments: normComments[i],
      normShares: normShares[i],
      normCostEff: normCostEff[i],
      engagementAvg,
    }
    return { ...row, score, breakdown }
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.netProfitAed !== a.netProfitAed) return b.netProfitAed - a.netProfitAed
    return String(a.latestDate || '').localeCompare(String(b.latestDate || ''))
  })

  scored.forEach((row, index) => {
    const rank = index + 1
    const score = row.score
    const score100 = Math.min(100, Math.max(0, Math.round(score * 100)))
    out.set(row.contractId, {
      rank,
      score,
      score100,
      contractId: row.contractId,
      breakdown: row.breakdown,
    })
  })

  return out
}

export function getTopInfluencer(records = [], influencers = []) {
  const byId = new Map()
  records.forEach((record) => {
    const current = byId.get(record.influencerId) || {
      influencerId: record.influencerId,
      views: 0,
      engagements: 0,
      cost: 0,
    }
    current.views += toNumber(record.views)
    current.engagements += toNumber(record.likes) + toNumber(record.comments) + toNumber(record.shares)
    current.cost += toNumber(record.cost)
    byId.set(record.influencerId, current)
  })

  const top = Array.from(byId.values()).sort((a, b) => b.views - a.views || b.engagements - a.engagements)[0]
  if (!top) return null
  const influencer = influencers.find((item) => String(item.id) === String(top.influencerId))
  return {
    ...top,
    name: influencer?.name || 'Unknown influencer',
    platform: influencer?.platform || 'Instagram',
  }
}

export function getDailyTotals(records = [], date = new Date().toISOString().slice(0, 10)) {
  return records
    .filter((record) => record.date === date)
    .reduce((totals, record) => ({
      views: totals.views + toNumber(record.views),
      likes: totals.likes + toNumber(record.likes),
      comments: totals.comments + toNumber(record.comments),
      shares: totals.shares + toNumber(record.shares),
      saves: totals.saves + toNumber(record.saves),
      salesAed: totals.salesAed + toNumber(record.salesAed),
      cost: totals.cost + toNumber(record.cost),
    }), {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      salesAed: 0,
      cost: 0,
    })
}

export function getPlatformStats(records = []) {
  const stats = new Map()
  records.forEach((record) => {
    const platform = record.platform || 'Unknown'
    const current = stats.get(platform) || {
      platform,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      cost: 0,
      records: 0,
    }
    current.views += toNumber(record.views)
    current.likes += toNumber(record.likes)
    current.comments += toNumber(record.comments)
    current.shares += toNumber(record.shares)
    current.saves += toNumber(record.saves)
    current.cost += toNumber(record.cost)
    current.records += 1
    stats.set(platform, current)
  })

  return Array.from(stats.values()).map((item) => ({
    ...item,
    engagementRate: calculateEngagementRate(item),
  }))
}

export function getHighestEngagementRecord(records = [], influencers = []) {
  const record = [...records].sort((a, b) => toNumber(b.engagementRate) - toNumber(a.engagementRate))[0]
  if (!record) return null
  const influencer = influencers.find((item) => String(item.id) === String(record.influencerId))
  return {
    ...record,
    influencerName: influencer?.name || 'Unknown influencer',
  }
}

export function normalizePerformanceRecord(record) {
  const date = isoDateSlice(record.date) || record.date
  const contractStartDate = isoDateSlice(record.contractStartDate || record.date) || record.contractStartDate || date
  const contractId = ensurePerformanceContractId({ ...record, contractStartDate, date })
  const normalized = {
    ...record,
    date,
    contractId,
    contractStartDate,
    monitoringDays: Math.max(4, Math.min(7, toNumber(record.monitoringDays) || 5)),
    videoTitle: record.videoTitle || record.campaignName || 'Contracted video',
    views: toNumber(record.views),
    likes: toNumber(record.likes),
    comments: toNumber(record.comments),
    shares: toNumber(record.shares),
    saves: toNumber(record.saves),
    salesAed: toNumber(record.salesAed),
    storyViews: toNumber(record.storyViews),
    cost: toNumber(record.cost),
    netProfitAed: record.netProfitAed != null && String(record.netProfitAed).trim() !== ''
      ? toNumber(record.netProfitAed)
      : undefined,
  }
  const out = {
    ...normalized,
    engagementRate: calculateEngagementRate(normalized),
  }
  if (out.netProfitAed === undefined) delete out.netProfitAed
  return out
}

export function createInfluencerFromAppRecord(record, index = 0) {
  const platforms = [
    record.tiktok?.handle && 'TikTok',
    record.instagram?.handle && 'Instagram',
    record.snapchat && 'Snapchat',
    record.youtube?.handle && 'YouTube',
    record.facebook && 'Facebook',
  ].filter(Boolean)
  const platform = platforms[0] || INFLUENCER_PLATFORMS[index % INFLUENCER_PLATFORMS.length]
  const username =
    platform === 'TikTok' ? record.tiktok?.handle :
      platform === 'YouTube' ? record.youtube?.handle :
        platform === 'Snapchat' ? record.snapchat :
          platform === 'Facebook' ? record.facebook :
            record.instagram?.handle

  return {
    id: String(record.id),
    name: record.name || 'Unnamed influencer',
    platform,
    username: username || record.instagram?.handle || record.youtube?.handle || '@creator',
    niche: record.niche || 'Lifestyle',
    profileImage: record.profileImageUrl || record.instagram?.picUrl || '',
    followers: toNumber(record.followersCount),
    assignedCampaign: record.campaign || record.collaborationType || 'General campaign',
    status: record.workflowStatus === 'Closed' ? 'Completed' : record.workflowStatus === 'Rejected' ? 'Paused' : 'Active',
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  }
}

export const mockInfluencers = [
  {
    id: 'inf-layla',
    name: 'Layla Noor',
    platform: 'Instagram',
    username: '@laylanoor',
    niche: 'Beauty & lifestyle',
    profileImage: '',
    followers: 186000,
    assignedCampaign: 'Ramadan Glow',
    status: 'Active',
    createdAt: '2026-04-01T08:00:00.000Z',
    updatedAt: '2026-04-30T10:00:00.000Z',
  },
  {
    id: 'inf-omar',
    name: 'Omar Eats',
    platform: 'TikTok',
    username: '@omareats',
    niche: 'Food reviews',
    profileImage: '',
    followers: 412000,
    assignedCampaign: 'Weekend Brunch',
    status: 'Active',
    createdAt: '2026-04-02T08:00:00.000Z',
    updatedAt: '2026-04-30T11:00:00.000Z',
  },
  {
    id: 'inf-mira',
    name: 'Mira Studio',
    platform: 'YouTube',
    username: '@mirastudio',
    niche: 'Home & decor',
    profileImage: '',
    followers: 97000,
    assignedCampaign: 'Spring Home Edit',
    status: 'Paused',
    createdAt: '2026-04-03T08:00:00.000Z',
    updatedAt: '2026-04-29T12:00:00.000Z',
  },
  {
    id: 'inf-sara',
    name: 'Sara Fit',
    platform: 'Snapchat',
    username: '@sarafit',
    niche: 'Fitness',
    profileImage: '',
    followers: 251000,
    assignedCampaign: 'Active May',
    status: 'Completed',
    createdAt: '2026-04-04T08:00:00.000Z',
    updatedAt: '2026-04-28T12:00:00.000Z',
  },
]

export function createMockPerformanceRecords(influencers = mockInfluencers) {
  const today = new Date()
  const day = (offsetFromToday) => {
    const date = new Date(today)
    date.setDate(today.getDate() - offsetFromToday)
    return date.toISOString().slice(0, 10)
  }

  return influencers.slice(0, 6).flatMap((influencer, influencerIndex) => (
    [0, 1, 2, 3, 4].map((dayIndex) => {
      const contractStartDate = day(4)
      const recordDate = addDays(contractStartDate, dayIndex)
      const views = 42000 + influencerIndex * 17500 + dayIndex * 6300
      const likes = Math.round(views * (0.045 + influencerIndex * 0.006))
      const comments = Math.round(views * 0.0045)
      const shares = Math.round(views * 0.003)
      const record = {
        id: `perf-${influencer.id}-${dayIndex}`,
        contractId: `contract-${influencer.id}-${contractStartDate}`,
        influencerId: influencer.id,
        date: recordDate,
        platform: influencer.platform,
        postUrl: `https://example.com/${influencer.username.replace('@', '')}/weekly-video`,
        campaignName: influencer.assignedCampaign,
        contractStartDate,
        monitoringDays: 5,
        views,
        likes,
        comments,
        shares,
        salesAed: 0,
        engagementRate: 0,
        cost: 1200 + influencerIndex * 450,
        notes: dayIndex === 0 ? 'Day 1 baseline after upload.' : '',
        screenshotUrl: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      return normalizePerformanceRecord(record)
    })
  ))
}
