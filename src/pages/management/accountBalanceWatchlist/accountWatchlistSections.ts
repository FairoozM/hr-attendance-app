import type { ZohoWatchlistAccount } from '../../../api/zohoAccountWatchlist'

export type WatchlistSectionConfig = {
  id: string
  title: string
  /** Watched accounts are matched by Zoho account code, in this order. */
  accountCodes: string[]
}

export const WATCHLIST_SECTIONS: WatchlistSectionConfig[] = [
  {
    id: 'amazon-ksa-payments',
    title: 'Amazon KSA Payments',
    accountCodes: ['1024', '1026', '1028'],
  },
]

export type WatchlistSectionGroup = {
  id: string
  title: string
  accounts: ZohoWatchlistAccount[]
}

function normalizeCode(code: string | undefined): string {
  return String(code || '').trim()
}

/**
 * Split watched accounts into configured sections plus any remaining accounts.
 */
export function groupWatchlistAccounts(accounts: ZohoWatchlistAccount[]): WatchlistSectionGroup[] {
  const list = Array.isArray(accounts) ? accounts : []
  const byCode = new Map<string, ZohoWatchlistAccount>()
  for (const account of list) {
    const code = normalizeCode(account.accountCode)
    if (code && !byCode.has(code)) byCode.set(code, account)
  }

  const usedIds = new Set<string>()
  const groups: WatchlistSectionGroup[] = []

  for (const section of WATCHLIST_SECTIONS) {
    const sectionAccounts: ZohoWatchlistAccount[] = []
    for (const code of section.accountCodes) {
      const account = byCode.get(normalizeCode(code))
      if (account) {
        sectionAccounts.push(account)
        usedIds.add(account.accountId)
      }
    }
    if (sectionAccounts.length > 0) {
      groups.push({
        id: section.id,
        title: section.title,
        accounts: sectionAccounts,
      })
    }
  }

  const otherAccounts = list.filter((account) => !usedIds.has(account.accountId))
  if (otherAccounts.length > 0) {
    groups.push({
      id: 'other',
      title: 'Other watched accounts',
      accounts: otherAccounts,
    })
  }

  return groups
}
