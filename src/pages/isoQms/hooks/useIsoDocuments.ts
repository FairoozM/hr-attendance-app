import { useCallback, useEffect, useState } from 'react'
import { fetchIsoDocuments } from '../../../api/isoQms'
import type { IsoDocument, IsoDocumentFilters } from '../types'

export function useIsoDocuments(initialFilters: IsoDocumentFilters = {}) {
  const [filters, setFilters] = useState<IsoDocumentFilters>(initialFilters)
  const [items, setItems] = useState<IsoDocument[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchIsoDocuments(filters)
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, total, loading, error, filters, setFilters, refresh }
}
