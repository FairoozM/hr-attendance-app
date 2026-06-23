import { useMemo, useState } from 'react'
import type { ParsedRowStatus, ParsedSettlementRow } from '../../../../api/amazonPaymentClearing'

export interface ClearingRowFilter {
  search: string
  status: ParsedRowStatus | 'all'
  rowNumbers: number[] | null
}

const EMPTY_FILTER: ClearingRowFilter = { search: '', status: 'all', rowNumbers: null }

export function useClearingSearch(rows: ParsedSettlementRow[]) {
  const [filter, setFilter] = useState<ClearingRowFilter>(EMPTY_FILTER)

  const filtered = useMemo(() => {
    const search = filter.search.trim().toLowerCase()
    const rowNumberSet = filter.rowNumbers && filter.rowNumbers.length ? new Set(filter.rowNumbers) : null
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      if (filter.status !== 'all' && row.status !== filter.status) return false
      if (rowNumberSet && !rowNumberSet.has(row.rowNumber)) return false
      if (search) {
        const haystack = [
          row.orderId,
          row.category,
          row.rowClass,
          row.transactionType,
          row.amountType,
          row.amountDescription,
          row.blockingReason,
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })
  }, [rows, filter])

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: 0 }
    for (const row of Array.isArray(rows) ? rows : []) {
      map.all += 1
      map[row.status] = (map[row.status] || 0) + 1
    }
    return map
  }, [rows])

  function setSearch(search: string) {
    setFilter((prev) => ({ ...prev, search }))
  }
  function setStatus(status: ParsedRowStatus | 'all') {
    setFilter((prev) => ({ ...prev, status, rowNumbers: null }))
  }
  function focusRows(rowNumbers: number[], status: ParsedRowStatus | 'all' = 'all') {
    setFilter({ search: '', status, rowNumbers: rowNumbers && rowNumbers.length ? rowNumbers : null })
  }
  function reset() {
    setFilter(EMPTY_FILTER)
  }

  return { filter, filtered, counts, setSearch, setStatus, focusRows, reset }
}
