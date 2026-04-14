import { resolveApiUrl, AUTH_STORAGE_KEY } from './client.js'

function getAuthHeaders() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return {}
    const { token } = JSON.parse(raw)
    if (token) return { Authorization: `Bearer ${token}` }
  } catch {
    /* ignore */
  }
  return {}
}

/**
 * Fetches the annual leave request letter as PDF (inline or attachment disposition).
 */
export async function fetchAnnualLeaveLetterBlob(id, { attachment = false } = {}) {
  const q = attachment ? 'disposition=attachment' : 'disposition=inline'
  const url = resolveApiUrl(`/api/annual-leave/${id}/leave-request-letter?${q}`)
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/pdf',
      ...getAuthHeaders(),
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = res.statusText || 'Request failed'
    try {
      const j = JSON.parse(text)
      if (j && j.error) msg = j.error
    } catch {
      if (text) msg = text.slice(0, 200)
    }
    throw new Error(msg)
  }
  return res.blob()
}

export async function openAnnualLeaveLetterPreview(id) {
  const blob = await fetchAnnualLeaveLetterBlob(id, { attachment: false })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 120000)
}

export async function downloadAnnualLeaveLetterPdf(id) {
  const blob = await fetchAnnualLeaveLetterBlob(id, { attachment: true })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `leave-request-${id}.pdf`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
