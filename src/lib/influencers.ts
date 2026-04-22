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
  /** S3 object keys for insights screenshots (max 6); signed URLs loaded separately. */
  insightsImageKeys?: string[]
  /** Display rotation in degrees (0, 90, 180, 270) keyed by S3 object key. */
  insightsImageRotations?: Record<string, number>
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

export const updateInfluencer = async (
  id: string,
  payload: Influencer,
): Promise<{ success?: boolean; influencer?: Influencer } | null> => {
  return apiFetch(`/api/influencers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export const deleteInfluencer = (id: string) =>
  apiFetch(`/api/influencers/${id}`, {
    method: "DELETE",
  })

export async function fetchInsightsImageUrls(
  influencerId: string,
): Promise<{ key: string; url: string }[]> {
  const data = await apiFetch(`/api/influencers/${encodeURIComponent(influencerId)}/insights-images/urls`)
  return Array.isArray(data?.items) ? data.items : []
}

/** iOS/ Safari often send empty or application/octet-stream; must match presigned Content-Type. */
export function guessImageContentType(file: File): string {
  const t = (file.type || "").trim().toLowerCase()
  if (t.startsWith("image/")) {
    return t
  }
  const name = (file.name || "").toLowerCase()
  if (name.endsWith(".png")) return "image/png"
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg"
  if (name.endsWith(".webp")) return "image/webp"
  if (name.endsWith(".gif")) return "image/gif"
  if (name.endsWith(".heic") || name.endsWith(".heif")) return "image/heic"
  if (name.endsWith(".avif")) return "image/avif"
  return "image/jpeg"
}

export async function getInsightsImageUploadUrl(
  influencerId: string,
  payload: { fileName: string; contentType: string },
): Promise<{ uploadUrl: string; key: string }> {
  return apiFetch(`/api/influencers/${encodeURIComponent(influencerId)}/insights-images/upload-url`, {
    method: "POST",
    body: JSON.stringify({
      fileName: payload.fileName || "image.jpg",
      contentType: payload.contentType,
    }),
  })
}

export async function uploadInsightsImageToS3(
  uploadUrl: string,
  file: File,
  contentType: string,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": contentType },
  })
  if (!res.ok) {
    const hint = res.status === 403 ? " (CORS or signature mismatch; check S3 CORS and Content-Type)" : ""
    throw new Error(`Upload failed (HTTP ${res.status})${hint}`)
  }
}
