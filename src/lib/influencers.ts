import { apiFetch } from "./api"
import { normalizeInfluencerResponse } from "./influencerResponse"

export async function fetchInfluencersRaw(opts?: { page?: number; limit?: number }) {
  const q = new URLSearchParams()
  if (opts?.page != null) q.set("page", String(opts.page))
  if (opts?.limit != null) q.set("limit", String(opts.limit))
  const suffix = q.toString() ? `?${q.toString()}` : ""
  return apiFetch(`/api/influencers${suffix}`)
}

export const replaceInfluencersSnapshot = (influencers: any[]) =>
  apiFetch("/api/influencers", {
    method: "PUT",
    body: JSON.stringify({ influencers }),
  })

export const createInfluencer = async (payload: any) => {
  const raw = await fetchInfluencersRaw()
  const { items: current } = normalizeInfluencerResponse(raw as any)
  const next = [payload, ...current]
  await replaceInfluencersSnapshot(next)
  return payload
}

export const updateInfluencer = async (id: string, payload: any) => {
  const raw = await fetchInfluencersRaw()
  const { items: current } = normalizeInfluencerResponse(raw as any)
  const next = current.map((row: any) => (String(row?.id) === String(id) ? payload : row))
  await replaceInfluencersSnapshot(next)
  return payload
}

export const deleteInfluencer = (id: string) =>
  apiFetch(`/api/influencers/${id}`, {
    method: "DELETE",
  })
