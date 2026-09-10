import { useCallback, useEffect, useState } from 'react'
import { fetchIsoDashboard } from '../../../api/isoQms'
import type { IsoDashboardStats } from '../types'

const EMPTY: IsoDashboardStats = {
  totalControlledDocuments: 0,
  currentApprovedDocuments: 0,
  draftOrPendingDocuments: 0,
  obsoleteDocuments: 0,
  totalQmsRecords: 0,
  documentsRequiringReview: 0,
  expiredExternalCertificates: 0,
  openAuditFindings: 0,
  overdueCorrectiveActions: 0,
  openRisksRequiringAction: 0,
  upcomingCalibrationDates: 0,
  upcomingManagementReviews: 0,
  upcomingAudits: 0,
  checklist: [],
  recentUploads: [],
  recentlyRevised: [],
  awaitingApproval: [],
  correctiveActionsDue: [],
  expiredCertificates: [],
  calibrationsDue: [],
  recentActivity: [],
}

export function useIsoDashboard() {
  const [stats, setStats] = useState<IsoDashboardStats>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchIsoDashboard()
      setStats({ ...EMPTY, ...(data || {}) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
      setStats(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { stats, loading, error, refresh }
}
