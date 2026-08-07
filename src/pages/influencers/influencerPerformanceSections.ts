export type InfluencerPerformanceSection = 'leaderboard' | 'ranking' | 'timeline'

export const INFLUENCER_PERFORMANCE_SECTIONS: InfluencerPerformanceSection[] = [
  'leaderboard',
  'ranking',
  'timeline',
]

export const INFLUENCER_PERFORMANCE_SECTION_LABELS: Record<InfluencerPerformanceSection, string> = {
  leaderboard: 'Leaderboard',
  ranking: 'Performance Ranking',
  timeline: 'Contract Timeline',
}

export const DEFAULT_INFLUENCER_PERFORMANCE_SECTION: InfluencerPerformanceSection = 'leaderboard'

const SECTION_PARAM = 'section'

function isPerformanceSection(value: string | null): value is InfluencerPerformanceSection {
  return value === 'leaderboard' || value === 'ranking' || value === 'timeline'
}

export function readPerformanceSection(params: URLSearchParams): InfluencerPerformanceSection {
  const raw = params.get(SECTION_PARAM)
  return isPerformanceSection(raw) ? raw : DEFAULT_INFLUENCER_PERFORMANCE_SECTION
}

export function writePerformanceSection(
  params: URLSearchParams,
  section: InfluencerPerformanceSection,
): URLSearchParams {
  const next = new URLSearchParams(params)
  if (section === DEFAULT_INFLUENCER_PERFORMANCE_SECTION) {
    next.delete(SECTION_PARAM)
  } else {
    next.set(SECTION_PARAM, section)
  }
  return next
}

export function isPerformanceSectionActive(
  active: InfluencerPerformanceSection,
  target: InfluencerPerformanceSection,
): boolean {
  return active === target
}
