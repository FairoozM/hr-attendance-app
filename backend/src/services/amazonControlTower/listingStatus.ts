'use strict'

/**
 * Authoritative Amazon listing status for the Control Tower.
 *
 * Sources (KSA probe, Oct 2026):
 *   GET_MERCHANT_LISTINGS_ALL_DATA   one row per listing with Amazon's own `status` column
 *                                    (Active / Inactive / Incomplete) and `fulfillment-channel`.
 *   GET_MERCHANTS_LISTINGS_FYP_REPORT search-suppressed listings with status, reason and issue text.
 *
 * The Listings Items API (summaries.status BUYABLE/DISCOVERABLE + issues) would be richer but needs the
 * seller id, which this deployment does not have configured.
 *
 * UNKNOWN is never treated as ACTIVE. Amazon's raw status and reason are always kept alongside.
 */

const { normalizeSku } = require('../../utils/normalizeSku')

const LISTING_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUPPRESSED: 'SUPPRESSED',
  INCOMPLETE: 'INCOMPLETE',
  CLOSED: 'CLOSED',
  UNKNOWN: 'UNKNOWN',
})

const LISTING_STATUS_SOURCE = 'GET_MERCHANT_LISTINGS_ALL_DATA+GET_MERCHANTS_LISTINGS_FYP_REPORT'

type Row = Record<string, string>

function pick(row: Row, keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

function channelOf(raw: string): 'AMAZON' | 'DEFAULT' | 'UNKNOWN' {
  const c = raw.toLowerCase()
  if (!c) return 'UNKNOWN'
  if (c.includes('amazon') || c === 'afn' || c.includes('fba')) return 'AMAZON'
  if (c === 'default' || c === 'mfn' || c.includes('merchant')) return 'DEFAULT'
  return 'UNKNOWN'
}

type AllListingsRow = {
  sellerSku: string
  normalizedSku: string
  asin: string | null
  title: string | null
  fulfillmentChannel: 'AMAZON' | 'DEFAULT' | 'UNKNOWN'
  fulfillmentChannelRaw: string | null
  rawStatus: string | null
  openDate: string | null
}

function parseAllListingsRow(row: Row): AllListingsRow | null {
  const sellerSku = pick(row, ['seller-sku', 'sku', 'seller sku'])
  const normalizedSku = normalizeSku(sellerSku)
  if (!sellerSku || !normalizedSku) return null
  const channelRaw = pick(row, ['fulfillment-channel', 'fulfillment channel'])
  return {
    sellerSku,
    normalizedSku,
    asin: pick(row, ['asin1', 'asin', 'product-id']) || null,
    title: pick(row, ['item-name', 'item name', 'product-name']) || null,
    fulfillmentChannel: channelOf(channelRaw),
    fulfillmentChannelRaw: channelRaw || null,
    rawStatus: pick(row, ['status', 'listing-status']) || null,
    openDate: pick(row, ['open-date']) || null,
  }
}

type SuppressedRow = { sellerSku: string; normalizedSku: string; status: string | null; reason: string | null; issue: string | null; changedAt: string | null }

function parseSuppressedRow(row: Row): SuppressedRow | null {
  const sellerSku = pick(row, ['sku', 'seller-sku', 'seller sku'])
  const normalizedSku = normalizeSku(sellerSku)
  if (!sellerSku || !normalizedSku) return null
  return {
    sellerSku,
    normalizedSku,
    status: pick(row, ['status']) || null,
    reason: pick(row, ['reason']) || null,
    issue: pick(row, ['issue description', 'issue-description']) || null,
    changedAt: pick(row, ['status change date', 'status-change-date']) || null,
  }
}

type ListingClassification = { status: string; rawStatus: string | null; reason: string | null }

/**
 * Precedence: not in the all-listings report → UNKNOWN; search suppressed → SUPPRESSED (even if the raw
 * status is Active, the listing is not discoverable); then Amazon's raw status.
 */
function classifyListingStatus(input: { listing: AllListingsRow | null; suppressed: SuppressedRow | null }): ListingClassification {
  const { listing, suppressed } = input
  if (!listing) {
    return {
      status: LISTING_STATUS.UNKNOWN,
      rawStatus: null,
      reason: suppressed
        ? `Not in the all-listings report; FYP report: ${[suppressed.status, suppressed.reason].filter(Boolean).join(' — ')}`
        : 'Not present in the Amazon all-listings report',
    }
  }
  const raw = listing.rawStatus
  if (suppressed) {
    const parts = [suppressed.status, suppressed.reason, suppressed.issue].filter(Boolean)
    return { status: LISTING_STATUS.SUPPRESSED, rawStatus: raw, reason: parts.join(' — ') || 'Search suppressed' }
  }
  const s = String(raw || '').trim().toLowerCase()
  if (s === 'active') return { status: LISTING_STATUS.ACTIVE, rawStatus: raw, reason: null }
  if (s === 'inactive') return { status: LISTING_STATUS.INACTIVE, rawStatus: raw, reason: 'Amazon status Inactive (the all-listings report does not give the reason)' }
  if (s === 'incomplete') return { status: LISTING_STATUS.INCOMPLETE, rawStatus: raw, reason: 'Amazon status Incomplete (listing is missing required information)' }
  if (/closed|deleted|ended/.test(s)) return { status: LISTING_STATUS.CLOSED, rawStatus: raw, reason: `Amazon status ${raw}` }
  if (/suppress/.test(s)) return { status: LISTING_STATUS.SUPPRESSED, rawStatus: raw, reason: `Amazon status ${raw}` }
  return { status: LISTING_STATUS.UNKNOWN, rawStatus: raw, reason: raw ? `Unrecognised Amazon status "${raw}"` : 'Amazon status column is blank' }
}

/** Operational stock (KPIs, Inventory Health default view) counts ACTIVE listings only. */
function isOperationallyActive(status: string | null | undefined): boolean {
  return status === LISTING_STATUS.ACTIVE
}

/** Future replenishment must refuse anything that is not an ACTIVE Amazon listing. */
function replenishmentEligibility(row: { listingStatus: string | null | undefined }): { eligible: boolean; reason: string } {
  if (row.listingStatus === LISTING_STATUS.ACTIVE) return { eligible: true, reason: 'Amazon listing is ACTIVE' }
  if (!row.listingStatus) return { eligible: false, reason: 'Listing status not refreshed yet (treated as not active)' }
  return { eligible: false, reason: `Amazon listing is ${row.listingStatus}; only ACTIVE listings can be replenished` }
}

/** Listing class used to split physical capacity: ACTIVE, INACTIVE (any known non-active status) or OTHER_UNKNOWN. */
function capacityListingClass(status: string | null | undefined): 'ACTIVE' | 'INACTIVE' | 'OTHER_UNKNOWN' {
  if (status === LISTING_STATUS.ACTIVE) return 'ACTIVE'
  if (status === LISTING_STATUS.INACTIVE || status === LISTING_STATUS.SUPPRESSED || status === LISTING_STATUS.INCOMPLETE || status === LISTING_STATUS.CLOSED) {
    return 'INACTIVE'
  }
  return 'OTHER_UNKNOWN'
}

module.exports = {
  LISTING_STATUS,
  LISTING_STATUS_SOURCE,
  parseAllListingsRow,
  parseSuppressedRow,
  classifyListingStatus,
  isOperationallyActive,
  replenishmentEligibility,
  capacityListingClass,
}
