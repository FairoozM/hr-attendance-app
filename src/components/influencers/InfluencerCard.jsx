import { useEffect, useState } from 'react'
import { CalendarDays, Heart, MessageCircle, Share2, UsersRound, Video } from 'lucide-react'
import { formatNumber } from '../../utils/influencerPerformanceUtils'

function initials(name) {
  return String(name || 'IN')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'IN'
}

function displayHandle(username) {
  const value = String(username || '').trim()
  if (!value) return '@creator'
  return value.startsWith('@') ? value : `@${value}`
}

function statusClass(status) {
  if (status === 'Completed') return 'ip-status ip-status--completed'
  if (status === 'Paused') return 'ip-status ip-status--paused'
  return 'ip-status ip-status--active'
}

export function InfluencerCard({ influencer, latestRecord }) {
  const [imageError, setImageError] = useState(false)
  const showImage = Boolean(influencer.profileImage) && !imageError

  useEffect(() => {
    setImageError(false)
  }, [influencer.profileImage])

  return (
    <article className="ip-influencer-card">
      <div className="ip-influencer-card__top">
        <div className="ip-avatar">
          {showImage ? (
            <img src={influencer.profileImage} alt="" onError={() => setImageError(true)} />
          ) : (
            <span>{initials(influencer.name)}</span>
          )}
        </div>
        <span className={statusClass(influencer.status)}>{influencer.status}</span>
      </div>

      <div className="ip-influencer-card__body">
        <div className="ip-influencer-card__identity">
          <h3>{influencer.name}</h3>
          <p>{displayHandle(influencer.username)}</p>
        </div>
        <div className="ip-platform-pill">{influencer.platform}</div>
      </div>

      <div className="ip-influencer-card__meta">
        <span>{influencer.niche}</span>
        <span>{influencer.assignedCampaign}</span>
      </div>

      <div className="ip-influencer-card__followers">
        <UsersRound size={16} />
        <strong>{formatNumber(influencer.followers)}</strong>
        <span>followers</span>
      </div>

      <div className="ip-card-stats" aria-label={`${influencer.name} latest performance`}>
        <div>
          <Video size={15} />
          <strong>{formatNumber(latestRecord?.views)}</strong>
          <span>Views</span>
        </div>
        <div>
          <Heart size={15} />
          <strong>{formatNumber(latestRecord?.likes)}</strong>
          <span>Likes</span>
        </div>
        <div>
          <MessageCircle size={15} />
          <strong>{formatNumber(latestRecord?.comments)}</strong>
          <span>Comments</span>
        </div>
        <div>
          <Share2 size={15} />
          <strong>{formatNumber(latestRecord?.shares)}</strong>
          <span>Shares</span>
        </div>
      </div>

      <div className="ip-influencer-card__date">
        <CalendarDays size={14} />
        Latest recorded: {latestRecord?.date || 'No records yet'}
      </div>
    </article>
  )
}
