import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'

export function useAnnualLeave() {
  const [requests, setRequests] = useState([])
  const [alternateOptions, setAlternateOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dashboard, setDashboard] = useState(null)

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get('/api/annual-leave')
      setRequests(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Failed to load annual leave')
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await api.get('/api/annual-leave/dashboard')
      setDashboard(data)
    } catch { /* non-critical */ }
  }, [])

  const fetchAlternateOptions = useCallback(async () => {
    try {
      const data = await api.get('/api/annual-leave/alternate-options')
      setAlternateOptions(Array.isArray(data) ? data : [])
    } catch {
      setAlternateOptions([])
    }
  }, [])

  useEffect(() => {
    fetchRequests()
    fetchDashboard()
    fetchAlternateOptions()
  }, [fetchRequests, fetchDashboard, fetchAlternateOptions])

  const refresh = useCallback(async () => {
    await fetchRequests()
    await fetchDashboard()
    await fetchAlternateOptions()
  }, [fetchRequests, fetchDashboard, fetchAlternateOptions])

  const createRequest = useCallback(async (payload) => {
    const body = await api.post('/api/annual-leave', payload)
    await refresh()
    return body
  }, [refresh])

  const updateRequest = useCallback(async (id, payload) => {
    const body = await api.put(`/api/annual-leave/${id}`, payload)
    await refresh()
    return body
  }, [refresh])

  const deleteRequest = useCallback(async (id) => {
    await api.delete(`/api/annual-leave/${id}`)
    await refresh()
  }, [refresh])

  const confirmReturn = useCallback(async (id, payload) => {
    const body = await api.post(`/api/annual-leave/${id}/confirm-return`, payload)
    await refresh()
    return body
  }, [refresh])

  const extendLeave = useCallback(async (id, payload) => {
    const body = await api.post(`/api/annual-leave/${id}/extend`, payload)
    await refresh()
    return body
  }, [refresh])

  const updateRemarks = useCallback(async (id, payload) => {
    const body = await api.patch(`/api/annual-leave/${id}/remarks`, payload)
    await refresh()
    return body
  }, [refresh])

  const regenerateLeaveLetter = useCallback(async (id) => {
    const body = await api.post(`/api/annual-leave/${id}/leave-request-letter/regenerate`, {})
    await refresh()
    return body
  }, [refresh])

  const submitShopVisit = useCallback(
    async (id, payload) => {
      const body = await api.post(`/api/annual-leave/${id}/shop-visit/submit`, payload)
      await refresh()
      return body
    },
    [refresh]
  )

  const confirmShopVisit = useCallback(
    async (id, payload) => {
      const body = await api.post(`/api/annual-leave/${id}/shop-visit/confirm`, payload || {})
      await refresh()
      return body
    },
    [refresh]
  )

  const rescheduleShopVisit = useCallback(
    async (id, payload) => {
      const body = await api.post(`/api/annual-leave/${id}/shop-visit/reschedule`, payload)
      await refresh()
      return body
    },
    [refresh]
  )

  const completeShopVisit = useCallback(
    async (id) => {
      const body = await api.post(`/api/annual-leave/${id}/shop-visit/complete`, {})
      await refresh()
      return body
    },
    [refresh]
  )

  const applyShopVisitCalculator = useCallback(
    async (id) => {
      const body = await api.post(`/api/annual-leave/${id}/shop-visit/apply-calculator`, {})
      await refresh()
      return body
    },
    [refresh]
  )

  const patchShopVisitAdminNote = useCallback(
    async (id, payload) => {
      const body = await api.patch(`/api/annual-leave/${id}/shop-visit/admin-note`, payload)
      await refresh()
      return body
    },
    [refresh]
  )

  return {
    requests, loading, error, dashboard, alternateOptions,
    refresh, createRequest, updateRequest, deleteRequest,
    confirmReturn, extendLeave, updateRemarks, regenerateLeaveLetter,
    submitShopVisit,
    confirmShopVisit,
    rescheduleShopVisit,
    completeShopVisit,
    applyShopVisitCalculator,
    patchShopVisitAdminNote,
  }
}
