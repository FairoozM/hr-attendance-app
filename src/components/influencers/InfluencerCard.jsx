import { CalendarDays, Heart, MessageCircle, Share2, Sparkles, UsersRound, Video } from 'lucide-react'
import { formatNumber } from '../../utils/influencerPerformanceUtils'

function initials(name) {
  return String(name || 'IN')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'IN'
}

function statusClass(status) {
  if (status === 'Completed') return 'ip-status ip-status--completed'
  if (status === 'Paused') return 'ip-status ip-status--paused'
  return 'ip-status ip-status--active'
}

export function InfluencerCard({ influencer, latestRecord }) {
  return (
    <article className="ip-influencer-card">
      <div className="ip-influencer-card__top">
        <div className="ip-avatar">
          {influencer.profileImage ? (
            <img src={influencer.profileImage} alt={influencer.name} />
          ) : (
            <span>{initials(influencer.name)}</span>
          )}
        </div>
        <span className={statusClass(influencer.status)}>{influencer.status}</span>
      </div>

      <div className="ip-influencer-card__body">
        <div>
          <h3>{influencer.name}</h3>
          <p>{influencer.username}</p>
        </div>
        <div className="ip-platform-pill">
          <Sparkles size={14} />
          {influencer.platform}
        </div>
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
