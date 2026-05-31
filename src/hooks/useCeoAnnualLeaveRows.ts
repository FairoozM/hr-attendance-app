/**
 * CEO view row source — real API data first, localStorage mock fallback in dev only.
 * Does not alter useAnnualLeave or backend fetching.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  clearAnnualLeaveMockData,
  getCeoRowsFromMockStorage,
  seedAnnualLeaveMockDataIfEmpty,
} from '../lib/annualLeaveMockData'

type LeaveRow = Record<string, unknown>

export function useCeoAnnualLeaveRows(requests: LeaveRow[], loading: boolean) {
  const [mockVersion, setMockVersion] = useState(0)

  useEffect(() => {
    seedAnnualLeaveMockDataIfEmpty()
  }, [])

  const usingMock = useMemo(() => {
    if (!import.meta.env.DEV || loading) return false
    return !(requests?.length > 0)
  }, [requests, loading])

  const rows = useMemo(() => {
    if (loading) return []
    if (requests?.length > 0) return requests
    if (!import.meta.env.DEV) return []
    // mockVersion triggers re-read after dev reset
    void mockVersion
    return getCeoRowsFromMockStorage()
  }, [requests, loading, mockVersion])

  const reloadMockData = useCallback(() => {
    seedAnnualLeaveMockDataIfEmpty()
    setMockVersion((v) => v + 1)
  }, [])

  const resetMockData = useCallback(() => {
    if (!import.meta.env.DEV) return
    clearAnnualLeaveMockData()
    seedAnnualLeaveMockDataIfEmpty()
    setMockVersion((v) => v + 1)
  }, [])

  return {
    rows,
    allRequests: rows,
    usingMock: usingMock && rows.length > 0,
    reloadMockData,
    resetMockData,
  }
}
