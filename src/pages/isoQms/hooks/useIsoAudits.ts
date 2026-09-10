import { useCallback, useEffect, useState } from 'react'
import { fetchIsoAudit, fetchIsoAudits } from '../../../api/isoQms'
import type { IsoAudit } from '../types'

export function useIsoAudits(filters: Record<string, unknown> = {}) {
  const [items, setItems] = useState<IsoAudit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchIsoAudits(filters)
      setItems(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audits')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, loading, error, refresh }
}

export function useIsoAudit(id?: string | number) {
  const [audit, setAudit] = useState<IsoAudit | null>(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!id) {
      setAudit(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      setAudit(await fetchIsoAudit(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit')
      setAudit(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { audit, loading, error, refresh }
}
