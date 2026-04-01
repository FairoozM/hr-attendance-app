import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'

export function useAnnualLeave() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

  useEffect(() => {
    fetchRequests()
  }, [fetchRequests])

  const createRequest = useCallback(
    async (payload) => {
      const body = await api.post('/api/annual-leave', payload)
      await fetchRequests()
      return body
    },
    [fetchRequests]
  )

  const updateRequest = useCallback(
    async (id, payload) => {
      const body = await api.put(`/api/annual-leave/${id}`, payload)
      await fetchRequests()
      return body
    },
    [fetchRequests]
  )

  const deleteRequest = useCallback(
    async (id) => {
      await api.delete(`/api/annual-leave/${id}`)
      await fetchRequests()
    },
    [fetchRequests]
  )

  return {
    requests,
    loading,
    error,
    refresh: fetchRequests,
    createRequest,
    updateRequest,
    deleteRequest,
  }
}
