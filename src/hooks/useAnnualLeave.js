import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'

export function useAnnualLeave() {
  const [requests, setRequests] = useState([])
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

  useEffect(() => {
    fetchRequests()
    fetchDashboard()
  }, [fetchRequests, fetchDashboard])

  const refresh = useCallback(async () => {
    await fetchRequests()
    await fetchDashboard()
  }, [fetchRequests, fetchDashboard])

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

  return {
    requests, loading, error, dashboard,
    refresh, createRequest, updateRequest, deleteRequest,
    confirmReturn, extendLeave, updateRemarks, regenerateLeaveLetter,
  }
}
