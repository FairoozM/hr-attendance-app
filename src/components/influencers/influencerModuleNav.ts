/** Base path for the Influencer module (matches existing app convention). */
export const INFLUENCER_MODULE_BASE = '/influencers'

export type InfluencerModuleTab = {
  key: string
  label: string
  to: string
  /** Permission action on the `influencers` module; `view` when omitted. */
  action?: 'view' | 'performance' | 'payments' | 'agreements' | 'manage'
}

export const INFLUENCER_MODULE_TABS: InfluencerModuleTab[] = [
  { key: 'dashboard', label: 'Dashboard', to: `${INFLUENCER_MODULE_BASE}/dashboard` },
  { key: 'contracts', label: 'Performance Contracts', to: `${INFLUENCER_MODULE_BASE}/contracts` },
  { key: 'performance', label: 'Performance', to: `${INFLUENCER_MODULE_BASE}/performance`, action: 'performance' },
  { key: 'analytics', label: 'Analytics', to: `${INFLUENCER_MODULE_BASE}/analytics` },
  { key: 'timeline', label: 'Timeline', to: `${INFLUENCER_MODULE_BASE}/timeline` },
  { key: 'payments', label: 'Payments & ROI', to: `${INFLUENCER_MODULE_BASE}/payments`, action: 'payments' },
]

/** Segments reserved for module tabs — not influencer profile ids. */
export const INFLUENCER_RESERVED_SEGMENTS = new Set([
  'dashboard',
  'contracts',
  'performance',
  'payments',
  'timeline',
  'analytics',
  'list',
  'new',
  'agreements',
])
