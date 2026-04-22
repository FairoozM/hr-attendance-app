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

/** Batch presign: 1 round trip for N files. Falls back to N parallel single-presign calls if missing. */
export async function getInsightsImageUploadUrlsBatch(
  influencerId: string,
  items: { fileName: string; contentType: string }[],
): Promise<{ uploadUrl: string; key: string; contentType: string }[]> {
  try {
    const data = await apiFetch(
      `/api/influencers/${encodeURIComponent(influencerId)}/insights-images/upload-urls`,
      {
        method: "POST",
        body: JSON.stringify({ items }),
      },
    )
    if (Array.isArray(data?.items) && data.items.length === items.length) {
      return data.items
    }
    throw new Error("Batch endpoint returned unexpected payload")
  } catch (err) {
    const out = await Promise.all(
      items.map(async (it) => {
        const r = await getInsightsImageUploadUrl(influencerId, it)
        return { uploadUrl: r.uploadUrl, key: r.key, contentType: it.contentType }
      }),
    )
    return out
  }
}

/** Upload via XHR so we get progress events; same end result as a fetch PUT. */
export function uploadInsightsImageToS3(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", uploadUrl, true)
    xhr.setRequestHeader("Content-Type", contentType)
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        const hint =
          xhr.status === 403
            ? " (CORS or signature mismatch; check S3 CORS and Content-Type)"
            : ""
        reject(new Error(`Upload failed (HTTP ${xhr.status})${hint}`))
      }
    }
    xhr.onerror = () => reject(new Error("Network error during upload"))
    xhr.onabort = () => reject(new Error("Upload aborted"))
    xhr.send(file)
  })
}
