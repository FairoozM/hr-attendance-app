export const INFLUENCER_PLATFORMS = ['TikTok', 'Instagram', 'Snapchat', 'YouTube', 'Facebook']

export const INFLUENCER_PERFORMANCE_STATUSES = ['Active', 'Paused', 'Completed']

export function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value == null || value === '') return 0
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export function calculateEngagementRate({ likes = 0, comments = 0, shares = 0, saves = 0, views = 0 } = {}) {
  const safeViews = toNumber(views)
  if (safeViews <= 0) return 0
  const interactions = toNumber(likes) + toNumber(comments) + toNumber(shares) + toNumber(saves)
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
  const date = new Date(`${dateString}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function getDayNumber(startDate, date) {
  if (!startDate || !date) return null
  const start = new Date(`${startDate}T00:00:00`).getTime()
  const current = new Date(`${date}T00:00:00`).getTime()
  if (Number.isNaN(start) || Number.isNaN(current)) return null
  return Math.floor((current - start) / 86_400_000) + 1
}

export function getVideoContractKey(record = {}) {
  if (record.contractId) return String(record.contractId)
  const influencerId = record.influencerId || 'unknown'
  const video = record.postUrl || record.videoTitle || record.campaignName || 'video'
  const startDate = record.contractStartDate || record.date || 'no-date'
  return `${influencerId}::${String(video).trim().toLowerCase()}::${startDate}`
}

export function getPerformanceRecordKey(record = {}) {
  return `${getVideoContractKey(record)}::${record.date || 'no-date'}`
}

export function dedupePerformanceRecords(records = []) {
  const byKey = new Map()
  records.forEach((record) => {
    const key = getPerformanceRecordKey(record)
    const current = byKey.get(key)
    if (!current) {
      byKey.set(key, record)
      return
    }
    const currentTime = new Date(current.updatedAt || current.createdAt || 0).getTime()
    const nextTime = new Date(record.updatedAt || record.createdAt || 0).getTime()
    byKey.set(key, nextTime >= currentTime ? record : current)
  })
  return Array.from(byKey.values())
}

export function getVideoContractTimelines(records = [], influencers = [], daysFallback = 5) {
  const influencersById = new Map(influencers.map((item) => [String(item.id), item]))
  const grouped = new Map()

  dedupePerformanceRecords(records).forEach((record) => {
    const key = getVideoContractKey(record)
    const current = grouped.get(key) || {
      id: key,
      influencerId: record.influencerId,
      influencer: influencersById.get(String(record.influencerId)),
      platform: record.platform,
      videoTitle: record.videoTitle || record.campaignName || 'Contracted video',
      postUrl: record.postUrl || '',
      campaignName: record.campaignName || 'Campaign',
      contractStartDate: record.contractStartDate || record.date,
      monitoringDays: toNumber(record.monitoringDays) || daysFallback,
      records: [],
      totals: {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        cost: 0,
      },
    }

    current.records.push(record)
    current.contractStartDate = current.contractStartDate < record.date ? current.contractStartDate : (record.contractStartDate || record.date)
    current.monitoringDays = Math.max(current.monitoringDays, toNumber(record.monitoringDays) || daysFallback)
    current.totals.views += toNumber(record.views)
    current.totals.likes += toNumber(record.likes)
    current.totals.comments += toNumber(record.comments)
    current.totals.shares += toNumber(record.shares)
    current.totals.saves += toNumber(record.saves)
    current.totals.cost += toNumber(record.cost)
    grouped.set(key, current)
  })

  return Array.from(grouped.values())
    .map((contract) => {
      const orderedRecords = [...contract.records].sort((a, b) => a.date.localeCompare(b.date))
      const startDate = contract.contractStartDate || orderedRecords[0]?.date
      const monitoringDays = Math.max(4, Math.min(7, toNumber(contract.monitoringDays) || daysFallback))
      const days = Array.from({ length: monitoringDays }, (_, index) => {
        const date = addDays(startDate, index)
        const record = orderedRecords.find((item) => item.date === date)
        return {
          dayNumber: index + 1,
          date,
          record,
          isRecorded: Boolean(record),
        }
      })
      const latest = orderedRecords[orderedRecords.length - 1]
      return {
        ...contract,
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
    current.engagements += toNumber(record.likes) + toNumber(record.comments) + toNumber(record.shares) + toNumber(record.saves)
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
      followersGained: totals.followersGained + toNumber(record.followersGained),
      cost: totals.cost + toNumber(record.cost),
    }), {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      followersGained: 0,
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
  const contractStartDate = record.contractStartDate || record.date
  const contractId = record.contractId || getVideoContractKey({ ...record, contractStartDate })
  const normalized = {
    ...record,
    contractId,
    contractStartDate,
    monitoringDays: Math.max(4, Math.min(7, toNumber(record.monitoringDays) || 5)),
    videoTitle: record.videoTitle || record.campaignName || 'Contracted video',
    views: toNumber(record.views),
    likes: toNumber(record.likes),
    comments: toNumber(record.comments),
    shares: toNumber(record.shares),
    saves: toNumber(record.saves),
    followersGained: toNumber(record.followersGained),
    storyViews: toNumber(record.storyViews),
    cost: toNumber(record.cost),
  }
  return {
    ...normalized,
    engagementRate: calculateEngagementRate(normalized),
  }
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
    profileImage: record.instagram?.picUrl || '',
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
      const saves = Math.round(views * 0.0022)
      const record = {
        id: `perf-${influencer.id}-${dayIndex}`,
        contractId: `contract-${influencer.id}-${contractStartDate}`,
        influencerId: influencer.id,
        date: recordDate,
        platform: influencer.platform,
        postUrl: `https://example.com/${influencer.username.replace('@', '')}/weekly-video`,
        campaignName: influencer.assignedCampaign,
        videoTitle: `${influencer.assignedCampaign} weekly video`,
        contractStartDate,
        monitoringDays: 5,
        views,
        likes,
        comments,
        shares,
        saves,
        followersGained: Math.round(views * 0.0012),
        storyViews: Math.round(views * 0.28),
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
