import { resolveApiUrl } from '../api/client'

/** List-safe profile image URL (small proxied thumbnail, not full S3 download). */
export function resolveInfluencerProfileImageUrl(row) {
  if (!row) return ''
  const raw = row.profileImageUrl
  if (raw && String(raw).startsWith('/api/')) {
    return resolveApiUrl(raw)
  }
  if (row.profileImageKey && row.id != null) {
    return resolveApiUrl(`/api/influencers/${row.id}/profile-image`)
  }
  return raw || row.instagram?.picUrl || ''
}
