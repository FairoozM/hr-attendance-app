import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'

function toPayload(form) {
  return {
    name:              String(form.name             || '').trim(),
    document_type:     String(form.documentType     || '').trim(),
    company:           String(form.company          || '').trim(),
    expiry_date:       form.expiryDate              || null,
    reminder_days:     Number(form.reminderDays     ?? 30),
    renewal_frequency: String(form.renewalFrequency || '').trim(),
    period_covered:    String(form.periodCovered    || '').trim(),
    notes:             String(form.notes            || '').trim(),
    workflow_status:   String(form.workflowStatus   || 'Pending').trim(),
  }
}

export function useDocumentExpiry() {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.get('/api/document-expiry')
      setItems(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Failed to load document expiry records')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const createItem = useCallback(async (form) => {
    const created = await api.post('/api/document-expiry', toPayload(form))
    setItems((prev) => [...prev, created])
    return created
  }, [])

  const updateItem = useCallback(async (id, form) => {
    const updated = await api.put(`/api/document-expiry/${id}`, toPayload(form))
    setItems((prev) => prev.map((r) => (r.id === String(id) ? updated : r)))
    return updated
  }, [])

  const deleteItem = useCallback(async (id) => {
    await api.delete(`/api/document-expiry/${id}`)
    setItems((prev) => prev.filter((r) => r.id !== String(id)))
  }, [])

  return { items, loading, error, createItem, updateItem, deleteItem, refetch: fetchAll }
}
