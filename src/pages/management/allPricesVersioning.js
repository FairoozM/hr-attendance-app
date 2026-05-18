import { computeEcommercePriceRow, makeRowId, normalizeAllPricesRows } from './allPricesEcommerceUtils'

export const DUPLICATE_CLASSIFICATION = {
  SAFE_AUTO_LATEST_DATE: 'SAFE_AUTO_LATEST_DATE',
  SAFE_AUTO_EXACT_DUPLICATE: 'SAFE_AUTO_EXACT_DUPLICATE',
  SAFE_AUTO_DATED_OVER_BLANK: 'SAFE_AUTO_DATED_OVER_BLANK',
  CONFLICT_SAME_DATE_DIFFERENT_VALUES: 'CONFLICT_SAME_DATE_DIFFERENT_VALUES',
  CONFLICT_ALL_BLANK_DATES_DIFFERENT_VALUES: 'CONFLICT_ALL_BLANK_DATES_DIFFERENT_VALUES',
  CONFLICT_AMBIGUOUS: 'CONFLICT_AMBIGUOUS',
}

export const IMPORT_STATUS = {
  NEW_ITEM: 'NEW_ITEM',
  UNCHANGED_EXISTING: 'UNCHANGED_EXISTING',
  CHANGED_NEWER_DATE: 'CHANGED_NEWER_DATE',
  CHANGED_SAME_DATE: 'CHANGED_SAME_DATE',
  OLDER_THAN_ACTIVE: 'OLDER_THAN_ACTIVE',
  MISSING_DATE: 'MISSING_DATE',
  DUPLICATE_ACTIVE_PRICE: 'DUPLICATE_ACTIVE_PRICE',
  DUPLICATE_IN_IMPORT: 'DUPLICATE_IN_IMPORT',
}

export const HISTORY_SOURCE = {
  DUPLICATE_CLEANUP: 'duplicate_cleanup',
  EXACT_DUPLICATE_CLEANUP: 'exact_duplicate_cleanup',
  IMPORT_REPLACEMENT: 'import_replacement',
  MANUAL_REPLACEMENT: 'manual_replacement',
  IMPORT_OLDER_PRICE: 'imported_older_price',
}

export function normalizeItemNo(itemNo) {
  return String(itemNo ?? '').trim().toUpperCase()
}

export function isValidPriceDate(value) {
  const s = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function normalizedDate(value) {
  return isValidPriceDate(value) ? String(value).trim() : ''
}

function normalizeNumberForCompare(value) {
  if (value === '' || value == null) return ''
  const n = Number(value)
  return Number.isFinite(n) ? Number(n.toFixed(6)) : String(value).trim()
}

export function getAllPriceBusinessSignature(row, rates) {
  const computed = computeEcommercePriceRow(row || {}, rates)
  return JSON.stringify({
    itemNo: normalizeItemNo(row?.itemNo),
    salesPrice: normalizeNumberForCompare(computed.salesPrice),
    vatAmount: normalizeNumberForCompare(computed.vatAmount),
    commissionAmount: normalizeNumberForCompare(computed.commissionAmount),
    advertisingAmount: normalizeNumberForCompare(computed.advertisingAmount),
    shipping: normalizeNumberForCompare(row?.shipping),
    purchasePrice: normalizeNumberForCompare(row?.purchasePrice),
    totalCost: normalizeNumberForCompare(computed.totalCost),
    profit: normalizeNumberForCompare(computed.profit),
    profitPct: normalizeNumberForCompare(computed.profitPct),
    dateOfPrices: normalizedDate(row?.dateOfPrices),
  })
}

export function groupDuplicatePrices(rows) {
  const normalizedRows = normalizeAllPricesRows(rows) || []
  const byItem = new Map()
  normalizedRows.forEach((row, index) => {
    const normalizedItemNo = normalizeItemNo(row.itemNo)
    if (!normalizedItemNo) return
    if (!byItem.has(normalizedItemNo)) byItem.set(normalizedItemNo, [])
    byItem.get(normalizedItemNo).push({ ...row, originalIndex: index, normalizedItemNo })
  })

  return [...byItem.entries()]
    .filter(([, groupRows]) => groupRows.length > 1)
    .map(([normalizedItemNo, groupRows]) => ({
      id: normalizedItemNo,
      normalizedItemNo,
      displayItemNo: groupRows.find((r) => String(r.itemNo || '').trim())?.itemNo || normalizedItemNo,
      rows: groupRows,
    }))
}

function uniqueBusinessSignatureCount(rows, rates) {
  return new Set(rows.map((row) => getAllPriceBusinessSignature(row, rates))).size
}

function classifyByDate(group, rates) {
  const dated = group.rows.filter((row) => isValidPriceDate(row.dateOfPrices))
  const blank = group.rows.filter((row) => !isValidPriceDate(row.dateOfPrices))

  if (dated.length === 0) {
    if (uniqueBusinessSignatureCount(group.rows, rates) === 1) {
      return {
        classification: DUPLICATE_CLASSIFICATION.SAFE_AUTO_EXACT_DUPLICATE,
        keepRowId: group.rows[0].id,
        reason: 'Duplicate cleanup - exact duplicate',
        source: HISTORY_SOURCE.EXACT_DUPLICATE_CLEANUP,
      }
    }
    return {
      classification: DUPLICATE_CLASSIFICATION.CONFLICT_ALL_BLANK_DATES_DIFFERENT_VALUES,
      keepRowId: null,
      reason: 'Conflict - blank dates with different values',
      source: HISTORY_SOURCE.DUPLICATE_CLEANUP,
    }
  }

  const byDate = new Map()
  dated.forEach((row) => {
    const key = normalizedDate(row.dateOfPrices)
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key).push(row)
  })
  for (const sameDateRows of byDate.values()) {
    if (sameDateRows.length > 1 && uniqueBusinessSignatureCount(sameDateRows, rates) > 1) {
      return {
        classification: DUPLICATE_CLASSIFICATION.CONFLICT_SAME_DATE_DIFFERENT_VALUES,
        keepRowId: null,
        reason: 'Conflict - same date with different values',
        source: HISTORY_SOURCE.DUPLICATE_CLEANUP,
      }
    }
  }

  const newestDate = [...byDate.keys()].sort().at(-1)
  const newestRows = byDate.get(newestDate) || []
  const keepRow = newestRows[0]
  if (!keepRow) {
    return {
      classification: DUPLICATE_CLASSIFICATION.CONFLICT_AMBIGUOUS,
      keepRowId: null,
      reason: 'Conflict - ambiguous duplicate group',
      source: HISTORY_SOURCE.DUPLICATE_CLEANUP,
    }
  }

  if (dated.length === 1 && blank.length > 0) {
    return {
      classification: DUPLICATE_CLASSIFICATION.SAFE_AUTO_DATED_OVER_BLANK,
      keepRowId: keepRow.id,
      reason: 'Duplicate cleanup - blank date duplicate',
      source: HISTORY_SOURCE.DUPLICATE_CLEANUP,
    }
  }

  return {
    classification: DUPLICATE_CLASSIFICATION.SAFE_AUTO_LATEST_DATE,
    keepRowId: keepRow.id,
    reason: 'Duplicate cleanup - older price date',
    source: HISTORY_SOURCE.DUPLICATE_CLEANUP,
  }
}

export function classifyDuplicateGroup(group, rates) {
  if (!group || !Array.isArray(group.rows) || group.rows.length <= 1) {
    return {
      classification: null,
      keepRowId: group?.rows?.[0]?.id || null,
      reason: '',
      source: HISTORY_SOURCE.DUPLICATE_CLEANUP,
    }
  }
  return classifyByDate(group, rates)
}

export function scanDuplicatePrices(rows, rates) {
  const groups = groupDuplicatePrices(rows).map((group) => {
    const decision = classifyDuplicateGroup(group, rates)
    const safe = String(decision.classification || '').startsWith('SAFE_AUTO_')
    return {
      ...group,
      ...decision,
      safe,
      conflict: !safe,
      rowsToMove: safe ? group.rows.filter((row) => row.id !== decision.keepRowId) : [],
    }
  })

  const safeGroups = groups.filter((group) => group.safe)
  const conflictGroups = groups.filter((group) => group.conflict)
  const exactDuplicateGroups = groups.filter(
    (group) => group.classification === DUPLICATE_CLASSIFICATION.SAFE_AUTO_EXACT_DUPLICATE,
  )
  const missingDateGroups = groups.filter(
    (group) =>
      group.classification === DUPLICATE_CLASSIFICATION.SAFE_AUTO_DATED_OVER_BLANK ||
      group.classification === DUPLICATE_CLASSIFICATION.CONFLICT_ALL_BLANK_DATES_DIFFERENT_VALUES,
  )

  return {
    groups,
    safeGroups,
    conflictGroups,
    exactDuplicateGroups,
    missingDateGroups,
    summary: {
      duplicateItemCount: groups.length,
      duplicateRowCount: groups.reduce((sum, group) => sum + group.rows.length, 0),
      safeAutoFixCount: safeGroups.reduce((sum, group) => sum + group.rowsToMove.length, 0),
      conflictGroupCount: conflictGroups.length,
      exactDuplicateGroupCount: exactDuplicateGroups.length,
      missingDateGroupCount: missingDateGroups.length,
    },
  }
}

export function buildHistoricalSnapshot(row, rates, options = {}) {
  const computed = computeEcommercePriceRow(row || {}, rates)
  const movedAt = options.movedAt || new Date().toISOString()
  return {
    historicalPriceId: options.historicalPriceId || `hist-${makeRowId()}`,
    originalActivePriceId: row?.id || null,
    replacementActivePriceId: options.replacementActivePriceId || null,
    itemNo: row?.itemNo != null ? String(row.itemNo) : '',
    normalizedItemNo: normalizeItemNo(row?.itemNo),
    salesPriceAed: computed.salesPrice,
    vat5: computed.vatAmount,
    commission15: computed.commissionAmount,
    advertising15: computed.advertisingAmount,
    shipping: row?.shipping ?? '',
    purchasePrice: row?.purchasePrice ?? '',
    totalCost: computed.totalCost,
    profitAed: computed.profit,
    profitPercent: computed.profitPct,
    pricingStatus: computed.denominatorInvalid ? 'incomplete' : 'complete',
    originalDateOfPrices: row?.dateOfPrices || '',
    movedAt,
    replacedAt: movedAt,
    movedBy: options.movedBy || '',
    replacedBy: options.movedBy || '',
    reason: options.reason || 'Moved to Historical Prices',
    source: options.source || HISTORY_SOURCE.MANUAL_REPLACEMENT,
    cleanupBatchId: options.cleanupBatchId || null,
    importBatchId: options.importBatchId || null,
    notes: options.notes || '',
    snapshot: {
      ...(row || {}),
      computed,
    },
  }
}

export function buildCleanupBatchId() {
  return `cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 7)}`
}

export function buildImportBatchId() {
  return `import-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 7)}`
}

export function applySafeDuplicateCleanup(rows, rates, options = {}) {
  const scan = options.scan || scanDuplicatePrices(rows, rates)
  const cleanupBatchId = options.cleanupBatchId || buildCleanupBatchId()
  const moveIds = new Set()
  const historyRows = []

  scan.safeGroups.forEach((group) => {
    group.rowsToMove.forEach((row) => {
      moveIds.add(row.id)
      historyRows.push(
        buildHistoricalSnapshot(row, rates, {
          movedAt: options.movedAt,
          movedBy: options.movedBy,
          reason: group.reason,
          source: group.source,
          cleanupBatchId,
          replacementActivePriceId: group.keepRowId,
        }),
      )
    })
  })

  const activeRows = (normalizeAllPricesRows(rows) || []).filter((row) => !moveIds.has(row.id))
  return {
    activeRows,
    historyRows,
    cleanupBatchId,
    scan,
    summary: {
      ...scan.summary,
      autoCleanedCount: historyRows.length,
      activeRowCount: activeRows.length,
      status: scan.conflictGroups.length ? 'completed_with_conflicts' : 'completed',
    },
  }
}

export function applyConflictResolution(rows, rates, selectionsByGroupId, options = {}) {
  const scan = options.scan || scanDuplicatePrices(rows, rates)
  const cleanupBatchId = options.cleanupBatchId || buildCleanupBatchId()
  const moveIds = new Set()
  const historyRows = []

  scan.conflictGroups.forEach((group) => {
    const keepRowId = selectionsByGroupId?.[group.id]
    if (!keepRowId) return
    group.rows.forEach((row) => {
      if (row.id === keepRowId) return
      moveIds.add(row.id)
      historyRows.push(
        buildHistoricalSnapshot(row, rates, {
          movedAt: options.movedAt,
          movedBy: options.movedBy,
          reason: 'Duplicate cleanup - admin selected active row',
          source: HISTORY_SOURCE.DUPLICATE_CLEANUP,
          cleanupBatchId,
          replacementActivePriceId: keepRowId,
        }),
      )
    })
  })

  return {
    activeRows: (normalizeAllPricesRows(rows) || []).filter((row) => !moveIds.has(row.id)),
    historyRows,
    cleanupBatchId,
  }
}

export function rowsBusinessEqual(a, b, rates) {
  return getAllPriceBusinessSignature(a, rates) === getAllPriceBusinessSignature(b, rates)
}

function compareDates(a, b) {
  const da = normalizedDate(a)
  const db = normalizedDate(b)
  if (!da && !db) return 0
  if (!da) return -1
  if (!db) return 1
  return da.localeCompare(db)
}

export function buildImportReview(incomingRows, activeRows, rates) {
  const incoming = (normalizeAllPricesRows(incomingRows) || []).map((row) => ({
    ...row,
    id: row.id || makeRowId(),
  }))
  const active = normalizeAllPricesRows(activeRows) || []
  const activeByItem = new Map()
  active.forEach((row) => {
    const key = normalizeItemNo(row.itemNo)
    if (!key) return
    if (!activeByItem.has(key)) activeByItem.set(key, [])
    activeByItem.get(key).push(row)
  })

  const incomingCounts = new Map()
  incoming.forEach((row) => {
    const key = normalizeItemNo(row.itemNo)
    if (key) incomingCounts.set(key, (incomingCounts.get(key) || 0) + 1)
  })

  const items = incoming.map((row) => {
    const normalizedItemNo = normalizeItemNo(row.itemNo)
    const matches = activeByItem.get(normalizedItemNo) || []
    const current = matches[0] || null
    let status = IMPORT_STATUS.NEW_ITEM
    let recommendedAction = 'add_active'
    let reason = ''

    if (!normalizedItemNo) {
      status = IMPORT_STATUS.MISSING_DATE
      recommendedAction = 'review_missing_item'
      reason = 'Missing item number'
    } else if ((incomingCounts.get(normalizedItemNo) || 0) > 1) {
      status = IMPORT_STATUS.DUPLICATE_IN_IMPORT
      recommendedAction = 'review_conflict'
      reason = 'Duplicate item number inside import'
    } else if (matches.length > 1) {
      status = IMPORT_STATUS.DUPLICATE_ACTIVE_PRICE
      recommendedAction = 'review_conflict'
      reason = 'Duplicate active prices already exist'
    } else if (!current) {
      status = IMPORT_STATUS.NEW_ITEM
      recommendedAction = 'add_active'
      reason = 'New item'
    } else if (!isValidPriceDate(row.dateOfPrices)) {
      status = IMPORT_STATUS.MISSING_DATE
      recommendedAction = 'review_missing_date'
      reason = 'Incoming row has no valid date'
    } else if (rowsBusinessEqual(row, current, rates)) {
      status = IMPORT_STATUS.UNCHANGED_EXISTING
      recommendedAction = 'ignore'
      reason = 'No business-field changes'
    } else {
      const dateCompare = compareDates(row.dateOfPrices, current.dateOfPrices)
      if (dateCompare > 0) {
        status = IMPORT_STATUS.CHANGED_NEWER_DATE
        recommendedAction = 'replace_active'
        reason = 'New production price'
      } else if (dateCompare === 0) {
        status = IMPORT_STATUS.CHANGED_SAME_DATE
        recommendedAction = 'review_conflict'
        reason = 'Same date with changed values'
      } else {
        status = IMPORT_STATUS.OLDER_THAN_ACTIVE
        recommendedAction = 'store_historical'
        reason = 'Imported older price'
      }
    }

    return {
      id: `review-${makeRowId()}`,
      normalizedItemNo,
      incoming: row,
      current,
      status,
      recommendedAction,
      selectedAction: recommendedAction,
      reason,
    }
  })

  const count = (status) => items.filter((item) => item.status === status).length
  const conflicts = items.filter((item) => ['review_conflict', 'review_missing_date', 'review_missing_item'].includes(item.recommendedAction))
  return {
    items,
    conflicts,
    safeItems: items.filter((item) => !conflicts.includes(item)),
    summary: {
      totalRows: items.length,
      newCount: count(IMPORT_STATUS.NEW_ITEM),
      updatedCount: count(IMPORT_STATUS.CHANGED_NEWER_DATE),
      unchangedCount: count(IMPORT_STATUS.UNCHANGED_EXISTING),
      olderCount: count(IMPORT_STATUS.OLDER_THAN_ACTIVE),
      missingDateCount: count(IMPORT_STATUS.MISSING_DATE),
      conflictCount:
        count(IMPORT_STATUS.CHANGED_SAME_DATE) +
        count(IMPORT_STATUS.DUPLICATE_ACTIVE_PRICE) +
        count(IMPORT_STATUS.DUPLICATE_IN_IMPORT),
    },
  }
}

export function applyImportReview(activeRows, review, rates, options = {}) {
  const importBatchId = options.importBatchId || buildImportBatchId()
  const activeList = normalizeAllPricesRows(activeRows) || []
  const activeByItem = new Map()
  activeList.forEach((row) => {
    const key = normalizeItemNo(row.itemNo)
    if (!key) return
    if (!activeByItem.has(key)) activeByItem.set(key, [])
    activeByItem.get(key).push(row)
  })
  const replacedKeys = new Set()
  const addedRows = []

  const historyRows = []
  const appliedItems = []
  for (const item of review?.items || []) {
    const action = item.selectedAction || item.recommendedAction
    const key = item.normalizedItemNo
    if (!key) continue

    if (action === 'add_active') {
      addedRows.push({ ...item.incoming, id: item.incoming.id || makeRowId() })
      appliedItems.push(item)
    } else if (action === 'replace_active' && item.current) {
      const replacement = { ...item.incoming, id: item.incoming.id || makeRowId() }
      historyRows.push(
        buildHistoricalSnapshot(item.current, rates, {
          movedAt: options.movedAt,
          movedBy: options.movedBy,
          reason: 'New production price',
          source: HISTORY_SOURCE.IMPORT_REPLACEMENT,
          importBatchId,
          replacementActivePriceId: replacement.id,
        }),
      )
      replacedKeys.add(key)
      addedRows.push(replacement)
      appliedItems.push(item)
    } else if (action === 'store_historical') {
      historyRows.push(
        buildHistoricalSnapshot(item.incoming, rates, {
          movedAt: options.movedAt,
          movedBy: options.movedBy,
          reason: 'Imported older price',
          source: HISTORY_SOURCE.IMPORT_OLDER_PRICE,
          importBatchId,
          replacementActivePriceId: item.current?.id || null,
        }),
      )
      appliedItems.push(item)
    }
  }

  return {
    activeRows: [
      ...activeList.filter((row) => !replacedKeys.has(normalizeItemNo(row.itemNo))),
      ...addedRows,
    ],
    historyRows,
    importBatchId,
    summary: {
      totalRows: review?.items?.length || 0,
      appliedCount: appliedItems.length,
      historyCount: historyRows.length,
      conflictCount: review?.conflicts?.length || 0,
    },
  }
}
