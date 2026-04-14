import { apiFetch } from "./api"

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
  await apiFetch("/api/influencers", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  return payload
}

export const updateInfluencer = async (id: string, payload: any) => {
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
