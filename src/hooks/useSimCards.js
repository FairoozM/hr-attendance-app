import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'

function mapSimCard(row) {
  return {
    id: String(row.id),
    number: row.number ?? '',
    remarks: row.remarks ?? '',
    person: row.person ?? '',
    imeiNumber: row.imei_number ?? '',
    mobileNumber: row.mobile_number ?? '',
    monthlyChargesAed: Number(row.monthly_charges_aed ?? 0),
    usage: row.usage ?? 'Yes',
    type: row.type ?? '',
    issued: row.issued ?? '',
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

function toPayload(form) {
  return {
    number: String(form.number || '').trim(),
    remarks: String(form.remarks || '').trim(),
    person: String(form.person || '').trim(),
    imei_number: String(form.imeiNumber || '').trim(),
    mobile_number: String(form.mobileNumber || '').trim(),
    monthly_charges_aed: Number(form.monthlyChargesAed || 0),
    usage: String(form.usage || '').trim(),
    type: String(form.type || '').trim(),
    issued: String(form.issued || '').trim(),
  }
}

export function useSimCards() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.get('/api/sim-cards')
      setItems(Array.isArray(data) ? data.map(mapSimCard) : [])
    } catch (err) {
      setError(err.message || 'Failed to load sim cards list')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const createItem = useCallback(async (form) => {
    const created = await api.post('/api/sim-cards', toPayload(form))
    setItems((prev) => [...prev, mapSimCard(created)])
  }, [])

  const updateItem = useCallback(async (id, form) => {
    const updated = await api.put(`/api/sim-cards/${id}`, toPayload(form))
    setItems((prev) => prev.map((row) => (row.id === String(id) ? mapSimCard(updated) : row)))
  }, [])

  const deleteItem = useCallback(async (id) => {
    await api.delete(`/api/sim-cards/${id}`)
    setItems((prev) => prev.filter((row) => row.id !== String(id)))
  }, [])

  return {
    items,
    loading,
    error,
    createItem,
    updateItem,
    deleteItem,
    refetch: fetchAll,
  }
}
