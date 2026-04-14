export type InfluencerResponse =
  | any[]
  | {
      data?: any[]
      influencers?: any[]
      items?: any[]
      total?: number
      totalPages?: number
      page?: number
      limit?: number
    }

export type NormalizedInfluencerResponse = {
  items: any[]
  total: number
  totalPages: number
  page: number
  limit: number
  /** True when the payload represents the full dataset (safe to paginate in the client). */
  isFullListClientPaging: boolean
}

function computeTotalPages(total: number, limit: number, explicit?: number) {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return Math.max(1, explicit)
  if (limit > 0) return Math.max(1, Math.ceil(total / limit))
  return 1
}

export function normalizeInfluencerResponse(payload: InfluencerResponse): NormalizedInfluencerResponse {
  if (Array.isArray(payload)) {
    const n = payload.length
    const limit = n || 10
    return {
      items: payload,
      total: n,
      totalPages: 1,
      page: 1,
      limit,
      isFullListClientPaging: true,
    }
  }

  const items = payload?.influencers ?? payload?.data ?? payload?.items ?? []
  const total = typeof payload?.total === 'number' ? payload.total : items.length
  const page = typeof payload?.page === 'number' ? payload.page : 1
  const limit =
    typeof payload?.limit === 'number' && payload.limit > 0
      ? payload.limit
      : items.length || 10
  const totalPages = computeTotalPages(total, limit, payload?.totalPages)
  const isFullListClientPaging = items.length >= total

  return {
    items,
    total,
    totalPages,
    page,
    limit,
    isFullListClientPaging,
  }
}
