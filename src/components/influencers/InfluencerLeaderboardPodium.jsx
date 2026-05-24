import { Crown, Medal } from 'lucide-react'
import { formatNumber, toNumber } from '../../utils/influencerPerformanceUtils'
import { influencerInitials } from './influencerPerformanceTableShared'

/** Latest-record snapshot bests across all contracts (for mini winner highlights). */
function getDatasetBestsFromContracts(contracts) {
  if (!contracts?.length) return null
  let maxSales = -Infinity
  let maxViews = -Infinity
  let maxLikes = -Infinity
  let minCost = Infinity
  contracts.forEach((c) => {
    const rec = c.latest || {}
    maxSales = Math.max(maxSales, toNumber(rec.salesAed))
    maxViews = Math.max(maxViews, toNumber(rec.views))
    maxLikes = Math.max(maxLikes, toNumber(rec.likes))
    minCost = Math.min(minCost, toNumber(rec.cost))
  })
  if (minCost === Infinity) minCost = 0
  return { maxSales, maxViews, maxLikes, minCost }
}

function MiniStat({ label, value, isBest, variant }) {
  return (
    <div className="ip-leaderboard-card__stat">
      <span className="ip-leaderboard-card__stat-label">{label}</span>
      {isBest ? (
        <span className={`ip-table__winner-pill ip-table__winner-pill--${variant}`}>
          {value}
        </span>
      ) : (
        <strong className="ip-leaderboard-card__stat-value">{value}</strong>
      )}
    </div>
  )
}

function PodiumCard({
  contract,
  rankInfo,
  tier,
  bests,
  onSelect,
}) {
  const influencer = contract.influencer
  const name = influencer?.name || 'Unknown'
  const username = influencer?.username?.trim() || '—'
  const rec = contract.latest || {}
  const sales = toNumber(rec.salesAed)
  const views = toNumber(rec.views)
  const likes = toNumber(rec.likes)
  const cost = toNumber(rec.cost)

  const isBestSales = bests && sales === bests.maxSales && bests.maxSales > 0
  const isBestViews = bests && views === bests.maxViews && bests.maxViews > 0
  const isBestLikes = bests && likes === bests.maxLikes && bests.maxLikes > 0
  const isBestCost = bests && cost === bests.minCost

  return (
    <button
      type="button"
      className={`ip-leaderboard-card ip-leaderboard-card--${tier}`}
      onClick={() => onSelect?.(contract)}
    >
      <div className="ip-leaderboard-card__rank-badge" aria-hidden="true">
        {tier === 'gold' ? <Crown size={20} strokeWidth={2.2} /> : <Medal size={20} strokeWidth={2.2} />}
        <span>#{rankInfo.rank}</span>
      </div>
      <div className="ip-leaderboard-card__avatar" aria-hidden="true">
        <span>{influencerInitials(name)}</span>
        {influencer?.profileImage ? (
          <img
            src={influencer.profileImage}
            alt=""
            onError={(e) => {
              e.currentTarget.remove()
            }}
          />
        ) : null}
      </div>
      <div className="ip-leaderboard-card__copy">
        <strong className="ip-leaderboard-card__name">{name}</strong>
        <span className="ip-leaderboard-card__handle">@{username}</span>
        <span className="ip-leaderboard-card__campaign">{contract.campaignName || contract.videoTitle}</span>
      </div>
      <div className="ip-leaderboard-card__score-chip" title="Net profit (AED)">
        {formatNumber(toNumber(rec.netProfitAed), { currency: 'AED' })}
      </div>
      <div className="ip-leaderboard-card__stats">
        <MiniStat label="Sales" value={formatNumber(rec.salesAed, { currency: 'AED' })} isBest={isBestSales} variant="sales" />
        <MiniStat label="Views" value={formatNumber(rec.views)} isBest={isBestViews} variant="views" />
        <MiniStat label="Likes" value={formatNumber(rec.likes)} isBest={isBestLikes} variant="likes" />
        <MiniStat label="Cost" value={formatNumber(rec.cost, { currency: 'AED' })} isBest={isBestCost} variant="cost" />
      </div>
      <span className="ip-leaderboard-card__hint">Show contract timeline</span>
    </button>
  )
}

/**
 * Top 4 contracts by net profit rank, displayed in rank order.
 */
export function InfluencerLeaderboardPodium({
  videoContracts,
  rankingsByContractId,
  onSelectContract,
}) {
  if (!videoContracts?.length || !rankingsByContractId?.size) return null

  const sorted = [...videoContracts]
    .map((c) => ({ contract: c, rank: rankingsByContractId.get(String(c.id)) }))
    .filter((x) => x.rank)
    .sort((a, b) => a.rank.rank - b.rank.rank)

  if (sorted.length === 0) return null

  const ordered = sorted.slice(0, 4)
  const tierByRank = {
    1: 'gold',
    2: 'silver',
    3: 'bronze',
    4: 'standard',
  }

  const bests = getDatasetBestsFromContracts(videoContracts)

  return (
    <section className="ip-leaderboard-podium" aria-label="Top video contracts by net profit">
      <div className="ip-section-heading">
        <span className="ip-section-heading__icon"><Crown size={18} /></span>
        <div>
          <h2>Leaderboard</h2>
          <p className="ip-leaderboard-podium__subtitle">
            Ranked by net profit (AED). Click a card to open their contract timeline.
          </p>
        </div>
      </div>
      <div
        className={`ip-leaderboard-podium__grid ip-leaderboard-podium__grid--count-${ordered.length}`}
        role="list"
      >
        {ordered.map((item, i) => (
          <div key={item.contract.id} className="ip-leaderboard-podium__cell" role="listitem">
            <PodiumCard
              contract={item.contract}
              rankInfo={item.rank}
              tier={tierByRank[item.rank.rank] || 'standard'}
              bests={bests}
              onSelect={onSelectContract}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
