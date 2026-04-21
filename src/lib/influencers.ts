import { apiFetch } from "./api"

export type InfluencerSocial = {
  handle?: string
  url?: string
  picUrl?: string
}

export type InfluencerTimelineEntry = {
  event: string
  date: string
  note?: string
}

/** Shape stored in the JSON snapshot and used across influencer pages. */
export interface Influencer {
  id: string
  name: string
  mobile?: string
  whatsapp?: string
  email?: string
  nationality?: string
  basedIn?: string
  niche?: string
  notes?: string
  instagram?: InfluencerSocial
  youtube?: InfluencerSocial
  tiktok?: InfluencerSocial
  snapchat?: string
  facebook?: string
  twitter?: string
  telegram?: string
  website?: string
  otherSocial?: string
  followersCount?: string | number
  engagementRate?: string
  avgReelViews?: string
  avgStoryReach?: string
  audienceNotes?: string
  insightsReceived?: boolean
  reelsPrice?: string | number
  storiesPrice?: string | number
  packagePrice?: string | number
  currency?: string
  deliverables?: string
  collaborationType?: string
  reelStaysOnPage?: boolean
  contentForBrand?: boolean
  contactStatus?: string
  discussionNotes?: string
  negotiationNotes?: string
  offerShared?: boolean
  approvalNotes?: string
  rejectionNotes?: string
  followUpReminder?: string
  bankName?: string
  accountTitle?: string
  iban?: string
  paymentMethod?: string
  paymentNotes?: string
  workflowStatus: string
  approvalStatus: string
  paymentStatus: string
  assignedTo?: string
  shootDate?: string
  shootTime?: string
  shootLocation?: string
  campaign?: string
  agreementStatus?: string
  agreementGenerated?: boolean
  signedByInfluencer?: boolean
  signedByCompany?: boolean
  timeline?: InfluencerTimelineEntry[]
  createdAt?: string
  updatedAt?: string
}

export async function fetchInfluencersRaw(opts?: { page?: number; limit?: number }) {
  const q = new URLSearchParams()
  if (opts?.page != null) q.set("page", String(opts.page))
  if (opts?.limit != null) q.set("limit", String(opts.limit))
  const suffix = q.toString() ? `?${q.toString()}` : ""
  return apiFetch(`/api/influencers${suffix}`)
}

export const replaceInfluencersSnapshot = (influencers: Influencer[]) =>
  apiFetch("/api/influencers", {
    method: "PUT",
    body: JSON.stringify({ influencers }),
  })

export const createInfluencer = async (payload: Influencer) => {
  await apiFetch("/api/influencers", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  return payload
}

export const updateInfluencer = async (id: string, payload: Influencer) => {
  await apiFetch(`/api/influencers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
  return payload
}

export const deleteInfluencer = (id: string) =>
  apiFetch(`/api/influencers/${id}`, {
    method: "DELETE",
  })
