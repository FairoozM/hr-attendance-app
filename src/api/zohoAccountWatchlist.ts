import { api } from './client'

export type ZohoWatchlistFutureTransaction = {
  transactionId?: string
  transactionDate?: string
  transactionType?: string
  entryNumber?: string
  referenceNumber?: string
  description?: string
  debitAmount?: number | null
  creditAmount?: number | null
  impact?: number
}

export type ZohoWatchlistAccount = {
  accountId: string
  accountName: string
  accountCode: string
  accountType: string
  isActive?: boolean
  currentBalance: number | null
  closingBalance: number | null
  /** Balance including future-dated transactions. */
  fullBalance?: number | null
  /** fullBalance − currentBalance */
  futureImpact?: number | null
  futureTransactionCount?: number
  futureTransactions?: ZohoWatchlistFutureTransaction[]
  asOfDate?: string
  balanceUnavailable?: boolean
  notFoundInZoho?: boolean
  currencyCode?: string
  sortOrder?: number
  createdAt?: string
  refreshedAt?: string
  enrichError?: string
}

export type WatchlistResponse = {
  success: boolean
  accounts: ZohoWatchlistAccount[]
  empty?: boolean
  refreshedAt?: string
  asOfDate?: string
  message?: string
  count?: number
}

export type AllAccountsResponse = {
  success: boolean
  accounts: ZohoWatchlistAccount[]
  refreshedAt?: string
  count?: number
}

export async function fetchWatchlistAccounts(): Promise<WatchlistResponse> {
  return api.get('/api/zoho/account-watchlist', { timeoutMs: 180_000 }) as Promise<WatchlistResponse>
}

export async function fetchAllZohoAccountsWithBalances(): Promise<AllAccountsResponse> {
  return api.get('/api/zoho/account-watchlist/accounts', { timeoutMs: 120_000 }) as Promise<AllAccountsResponse>
}

export async function addAccountToWatchlist(accountId: string): Promise<{
  success: boolean
  account: ZohoWatchlistAccount
  alreadyWatched?: boolean
}> {
  return api.post(
    '/api/zoho/account-watchlist',
    { accountId },
    { timeoutMs: 120_000 },
  ) as Promise<{ success: boolean; account: ZohoWatchlistAccount; alreadyWatched?: boolean }>
}

export async function removeAccountFromWatchlist(accountId: string): Promise<{
  success: boolean
  removed: boolean
  accountId: string
}> {
  return api.delete(`/api/zoho/account-watchlist/${encodeURIComponent(accountId)}`) as Promise<{
    success: boolean
    removed: boolean
    accountId: string
  }>
}
