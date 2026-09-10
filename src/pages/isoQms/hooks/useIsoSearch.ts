import { useCallback, useState } from 'react'
import { searchIsoQms } from '../../../api/isoQms'
import type { IsoSearchResult } from '../types'

export function useIsoSearch() {
  const [items, setItems] = useState<IsoSearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const search = useCallback(async (params: Record<string, unknown>) => {
    setLoading(true)
    setError('')
    setQuery(String(params.q || params.query || ''))
    try {
      const data = await searchIsoQms(params)
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  return { items, total, loading, error, query, search }
}
