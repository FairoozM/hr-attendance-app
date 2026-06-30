import { useState, useCallback, useEffect } from 'react'
import {
  fetchSubscriptions,
  fetchSubscriptionSummary,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  fetchSubscription,
  type Subscription,
  type SubscriptionSummary,
  type SubscriptionFormPayload,
} from '../api/subscriptions'

export function useSubscriptions() {
  const [items, setItems] = useState<Subscription[]>([])
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refetch = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, sum] = await Promise.all([fetchSubscriptions(), fetchSubscriptionSummary()])
      setItems(list)
      setSummary(sum)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscriptions')
      setItems([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  const createItem = useCallback(async (form: SubscriptionFormPayload) => {
    const created = await createSubscription(form)
    await refetch()
    return created
  }, [refetch])

  const updateItem = useCallback(async (id: string, form: SubscriptionFormPayload) => {
    const updated = await updateSubscription(id, form)
    setItems((prev) => prev.map((r) => (r.id === id ? updated : r)))
    await fetchSubscriptionSummary().then(setSummary).catch(() => {})
    return updated
  }, [])

  const deleteItem = useCallback(async (id: string) => {
    await deleteSubscription(id)
    setItems((prev) => prev.filter((r) => r.id !== id))
    await fetchSubscriptionSummary().then(setSummary).catch(() => {})
  }, [])

  const refreshOne = useCallback(async (id: string) => {
    const detail = await fetchSubscription(id)
    setItems((prev) => prev.map((r) => (r.id === id ? detail : r)))
    await fetchSubscriptionSummary().then(setSummary).catch(() => {})
    return detail
  }, [])

  return {
    items,
    summary,
    loading,
    error,
    createItem,
    updateItem,
    deleteItem,
    refreshOne,
    refetch,
  }
}
