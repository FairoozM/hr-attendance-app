'use strict'

/**
 * Daily actions with stable keys: `${marketplace}:${type}:${entity}`. The same condition always maps to
 * the same key, so re-evaluating never creates duplicates; conditions that clear are resolved.
 * Capacity thresholds are mutually exclusive per period (only the highest band is raised).
 */

const ACTION_TYPE = Object.freeze({
  CAPACITY_ABOVE_80: 'CAPACITY_ABOVE_80',
  CAPACITY_ABOVE_90: 'CAPACITY_ABOVE_90',
  CAPACITY_CRITICAL: 'CAPACITY_CRITICAL',
  CAPACITY_LIMIT_MISSING: 'CAPACITY_LIMIT_MISSING',
  USAGE_COVERAGE_LOW: 'USAGE_COVERAGE_LOW',
  VOLUME_DATA_MISSING: 'VOLUME_DATA_MISSING',
  AGED_INVENTORY: 'AGED_INVENTORY',
  EXCESS_INVENTORY: 'EXCESS_INVENTORY',
  REMOVAL_ORDER_STUCK: 'REMOVAL_ORDER_STUCK',
  UNFULFILLABLE_INVENTORY: 'UNFULFILLABLE_INVENTORY',
  INACTIVE_WITH_FBA_STOCK: 'INACTIVE_WITH_FBA_STOCK',
})

type Action = {
  actionKey: string
  actionType: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  title: string
  detail: string
  entityType: string
  entityId: string
  metadata: Record<string, unknown>
}

type CapacityInput = {
  periodId: number
  storageType: string
  utilizationPct: number | null
  basis: 'OFFICIAL' | 'CALCULATED'
}

type BuildInput = {
  marketplaceKey: string
  thresholds: { warnPct: number; highPct: number; criticalPct: number; coverageMinPct: number }
  capacity: CapacityInput[]
  storageTypesWithStock: string[]
  coveragePct: number | null
  missingVolume: { sellerSku: string; onHandUnits: number; inboundUnits: number }[]
  health: { sellerSku: string; status: string; flags: string[]; agedUnits: number | null; daysOfCover: number | null; unfulfillable: number; listingStatus: string | null; physicalFbaUnits: number }[]
  stuckRemovals: { removalOrderId: string; lastUpdatedAt: string | null; orderStatus: string | null }[]
}

function buildActions(input: BuildInput): Action[] {
  const mk = input.marketplaceKey
  const out = new Map<string, Action>()
  const put = (a: Omit<Action, 'actionKey'>) => {
    const actionKey = `${mk}:${a.actionType}:${a.entityId}`
    if (!out.has(actionKey)) out.set(actionKey, { ...a, actionKey })
  }
  const t = input.thresholds

  for (const c of input.capacity) {
    if (c.utilizationPct == null) continue
    const pct = Math.round(c.utilizationPct * 10) / 10
    const base = { entityType: 'capacity_period', entityId: `period-${c.periodId}`, metadata: { periodId: c.periodId, storageType: c.storageType, utilizationPct: pct, basis: c.basis } }
    const basis = c.basis === 'OFFICIAL' ? 'Amazon-reported usage' : 'calculated estimate'
    if (pct >= t.criticalPct) put({ ...base, actionType: ACTION_TYPE.CAPACITY_CRITICAL, severity: 'CRITICAL', title: `${c.storageType} capacity critical: ${pct}%`, detail: `Utilization ${pct}% (${basis}) ≥ ${t.criticalPct}%.` })
    else if (pct >= t.highPct) put({ ...base, actionType: ACTION_TYPE.CAPACITY_ABOVE_90, severity: 'HIGH', title: `${c.storageType} capacity above ${t.highPct}%: ${pct}%`, detail: `Utilization ${pct}% (${basis}).` })
    else if (pct >= t.warnPct) put({ ...base, actionType: ACTION_TYPE.CAPACITY_ABOVE_80, severity: 'MEDIUM', title: `${c.storageType} capacity above ${t.warnPct}%: ${pct}%`, detail: `Utilization ${pct}% (${basis}).` })
  }

  const covered = new Set(input.capacity.map((c) => c.storageType))
  if (!covered.has('ALL')) {
    for (const st of input.storageTypesWithStock) {
      if (covered.has(st)) continue
      put({
        actionType: ACTION_TYPE.CAPACITY_LIMIT_MISSING,
        severity: 'HIGH',
        title: `No current capacity limit for ${st}`,
        detail: 'Enter the current Amazon capacity limit from Seller Central (Capacity page).',
        entityType: 'storage_type',
        entityId: st,
        metadata: { storageType: st },
      })
    }
  }

  if (input.coveragePct != null && input.coveragePct < t.coverageMinPct) {
    put({
      actionType: ACTION_TYPE.USAGE_COVERAGE_LOW,
      severity: 'MEDIUM',
      title: `Calculated usage covers ${Math.round(input.coveragePct * 10) / 10}% of FBA units`,
      detail: `Unit volume is missing for some SKUs; calculated usage is a lower bound (minimum ${t.coverageMinPct}%).`,
      entityType: 'marketplace',
      entityId: 'usage',
      metadata: { coveragePct: input.coveragePct },
    })
  }

  for (const m of input.missingVolume) {
    put({
      actionType: ACTION_TYPE.VOLUME_DATA_MISSING,
      severity: 'LOW',
      title: `Volume data missing: ${m.sellerSku}`,
      detail: `${m.onHandUnits + m.inboundUnits} FBA units have no unit volume from any source.`,
      entityType: 'sku',
      entityId: m.sellerSku,
      metadata: { onHandUnits: m.onHandUnits, inboundUnits: m.inboundUnits },
    })
  }

  for (const h of input.health) {
    if (h.flags.includes('INACTIVE_WITH_FBA_STOCK') && h.physicalFbaUnits > 0) {
      put({
        actionType: ACTION_TYPE.INACTIVE_WITH_FBA_STOCK,
        severity: 'HIGH',
        title: `Listing ${h.listingStatus || 'not refreshed'} with FBA stock: ${h.sellerSku}`,
        detail: `${h.physicalFbaUnits} FBA units on a listing that is not ACTIVE. Review: fix the listing or remove in Seller Central.`,
        entityType: 'sku',
        entityId: h.sellerSku,
        metadata: { listingStatus: h.listingStatus, units: h.physicalFbaUnits },
      })
    }
    if (h.status === 'AGED' || (h.agedUnits != null && h.agedUnits > 0)) {
      put({
        actionType: ACTION_TYPE.AGED_INVENTORY,
        severity: 'MEDIUM',
        title: `Aged inventory: ${h.sellerSku}`,
        detail: `${h.agedUnits ?? 0} units beyond the aged threshold.`,
        entityType: 'sku',
        entityId: h.sellerSku,
        metadata: { agedUnits: h.agedUnits },
      })
    }
    if (h.status === 'EXCESS') {
      put({
        actionType: ACTION_TYPE.EXCESS_INVENTORY,
        severity: 'MEDIUM',
        title: `Excess inventory: ${h.sellerSku}`,
        detail: `${h.daysOfCover == null ? '—' : Math.round(h.daysOfCover)} days of cover.`,
        entityType: 'sku',
        entityId: h.sellerSku,
        metadata: { daysOfCover: h.daysOfCover },
      })
    }
    if (h.unfulfillable > 0) {
      put({
        actionType: ACTION_TYPE.UNFULFILLABLE_INVENTORY,
        severity: 'MEDIUM',
        title: `Unfulfillable inventory: ${h.sellerSku}`,
        detail: `${h.unfulfillable} unfulfillable units occupy capacity.`,
        entityType: 'sku',
        entityId: h.sellerSku,
        metadata: { unfulfillable: h.unfulfillable },
      })
    }
  }

  for (const r of input.stuckRemovals) {
    put({
      actionType: ACTION_TYPE.REMOVAL_ORDER_STUCK,
      severity: 'MEDIUM',
      title: `Removal order not progressing: ${r.removalOrderId}`,
      detail: `Status ${r.orderStatus || 'unknown'}; last Amazon update ${r.lastUpdatedAt || 'unknown'}.`,
      entityType: 'removal_order',
      entityId: r.removalOrderId,
      metadata: { lastUpdatedAt: r.lastUpdatedAt, orderStatus: r.orderStatus },
    })
  }

  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
  return [...out.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || a.actionKey.localeCompare(b.actionKey))
}

module.exports = { ACTION_TYPE, buildActions }
