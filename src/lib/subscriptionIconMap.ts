import chatgptIcon from '../assets/subscription-icons/chatgpt.svg'
import cursorIcon from '../assets/subscription-icons/cursor.svg'
import awsIcon from '../assets/subscription-icons/aws.svg'
import zohoIcon from '../assets/subscription-icons/zoho.svg'
import adobeIcon from '../assets/subscription-icons/adobe.svg'
import envatoIcon from '../assets/subscription-icons/envato.svg'
import respondioIcon from '../assets/subscription-icons/respondio.svg'
import vercelIcon from '../assets/subscription-icons/vercel.svg'
import freepikIcon from '../assets/subscription-icons/freepik.svg'
import alibabaIcon from '../assets/subscription-icons/alibaba.svg'
import indeedIcon from '../assets/subscription-icons/indeed.svg'
import dialog360Icon from '../assets/subscription-icons/360dialog.svg'
import defaultIcon from '../assets/subscription-icons/default.svg'

export type SubscriptionIconKey =
  | 'chatgpt'
  | 'cursor'
  | 'aws'
  | 'zoho'
  | 'adobe'
  | 'envato'
  | 'respondio'
  | 'vercel'
  | 'freepik'
  | 'alibaba'
  | 'indeed'
  | '360dialog'
  | 'default'

/** Local asset URLs — bundled by Vite, no external hotlinks. */
export const SUBSCRIPTION_ICON_URLS: Record<SubscriptionIconKey, string> = {
  chatgpt: chatgptIcon,
  cursor: cursorIcon,
  aws: awsIcon,
  zoho: zohoIcon,
  adobe: adobeIcon,
  envato: envatoIcon,
  respondio: respondioIcon,
  vercel: vercelIcon,
  freepik: freepikIcon,
  alibaba: alibabaIcon,
  indeed: indeedIcon,
  '360dialog': dialog360Icon,
  default: defaultIcon,
}

/** Exact normalized keys → icon file stem. */
const EXACT_ICON_MAP: Record<string, SubscriptionIconKey> = {
  chatgpt: 'chatgpt',
  cursor: 'cursor',
  'amazon aws': 'aws',
  aws: 'aws',
  'zoho books': 'zoho',
  zoho: 'zoho',
  'adobe creative cloud': 'adobe',
  adobe: 'adobe',
  'envato elements': 'envato',
  envato: 'envato',
  'respond io': 'respondio',
  respondio: 'respondio',
  vercel: 'vercel',
  freepik: 'freepik',
  'alibaba seller account': 'alibaba',
  alibaba: 'alibaba',
  'indeed jobs': 'indeed',
  indeed: 'indeed',
  '360 dialog': '360dialog',
  '360dialog': '360dialog',
}

/** Partial substring matches, longest patterns first. */
const PARTIAL_ICON_MATCHES: Array<[string, SubscriptionIconKey]> = [
  ['adobe creative', 'adobe'],
  ['creative cloud', 'adobe'],
  ['envato', 'envato'],
  ['respond.io', 'respondio'],
  ['respond io', 'respondio'],
  ['zoho books', 'zoho'],
  ['zoho', 'zoho'],
  ['chatgpt', 'chatgpt'],
  ['openai', 'chatgpt'],
  ['360 dialog', '360dialog'],
  ['360dialog', '360dialog'],
  ['amazon aws', 'aws'],
  ['amazon web services', 'aws'],
  ['aws', 'aws'],
  ['alibaba seller', 'alibaba'],
  ['alibaba', 'alibaba'],
  ['indeed jobs', 'indeed'],
  ['indeed', 'indeed'],
  ['freepik', 'freepik'],
  ['vercel', 'vercel'],
  ['cursor', 'cursor'],
  ['adobe', 'adobe'],
]

function normalizeLabel(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\.io\b/g, ' io')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function resolveSubscriptionIconKey(name: string, vendor?: string): SubscriptionIconKey {
  const combined = normalizeLabel(`${name} ${vendor || ''}`)
  const nameOnly = normalizeLabel(name)
  const vendorOnly = normalizeLabel(vendor || '')

  for (const candidate of [combined, nameOnly, vendorOnly]) {
    if (candidate && EXACT_ICON_MAP[candidate]) {
      return EXACT_ICON_MAP[candidate]
    }
  }

  for (const [pattern, key] of PARTIAL_ICON_MATCHES) {
    if (combined.includes(pattern) || nameOnly.includes(pattern) || vendorOnly.includes(pattern)) {
      return key
    }
  }

  return 'default'
}

export function getSubscriptionIconUrl(name: string, vendor?: string): string {
  const key = resolveSubscriptionIconKey(name, vendor)
  return SUBSCRIPTION_ICON_URLS[key]
}
