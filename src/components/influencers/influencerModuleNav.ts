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
  { key: 'performance', label: 'Performance', to: `${INFLUENCER_MODULE_BASE}/performance`, action: 'performance' },
]

/** Segments reserved for module tabs — not influencer profile ids. */
export const INFLUENCER_RESERVED_SEGMENTS = new Set([
  'performance',
  'list',
  'new',
  'agreements',
])
