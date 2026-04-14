import { apiFetch } from "./api"

export const getInfluencers = () => apiFetch("/api/influencers")

export const replaceInfluencersSnapshot = (influencers: any[]) =>
  apiFetch("/api/influencers", {
    method: "PUT",
    body: JSON.stringify({ influencers }),
  })

export const createInfluencer = async (payload: any) => {
  const current = (await getInfluencers()) || []
  const next = [payload, ...current]
  await replaceInfluencersSnapshot(next)
  return payload
}

export const updateInfluencer = async (id: string, payload: any) => {
  const current = (await getInfluencers()) || []
  const next = current.map((row: any) => (String(row?.id) === String(id) ? payload : row))
  await replaceInfluencersSnapshot(next)
  return payload
}

export const deleteInfluencer = (id: string) =>
  apiFetch(`/api/influencers/${id}`, {
    method: "DELETE",
  })
