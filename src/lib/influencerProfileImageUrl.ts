import { resolveApiUrl } from '../api/client'
import type { Influencer } from './influencers'

type ProfileImageSource = Pick<Influencer, 'id' | 'profileImageKey' | 'profileImageUrl' | 'instagram'> & {
  profileImageUrl?: string | null
  profileImageKey?: string | null
  id?: string | number | null
}

/** List-safe profile image URL (small proxied thumbnail, not full S3 download). */
export function resolveInfluencerProfileImageUrl(row: ProfileImageSource | null | undefined): string {
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
