import { useState, useEffect } from 'react'
import { api } from '../api/client'

/**
 * Fetches the Zoho Inventory warehouse list once per mount.
 * Result is held in module-level memory so navigating away and back
 * doesn't re-fetch within the same session.
 *
 * Returns:
 *   warehouses  – array of { warehouse_id, warehouse_name, is_primary, status }
 *   loading     – true while the first fetch is in flight
 *   error       – string | null
 */

let _cachedWarehouses = null

export function useWarehouses() {
  const [warehouses, setWarehouses] = useState(_cachedWarehouses || [])
  const [loading, setLoading]       = useState(_cachedWarehouses === null)
  const [error, setError]           = useState(null)

  useEffect(() => {
    if (_cachedWarehouses !== null) {
      setWarehouses(_cachedWarehouses)
      setLoading(false)
      return
    }
    let cancelled = false
    api.get('/api/weekly-reports/warehouses')
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data?.warehouses) ? data.warehouses : []
        _cachedWarehouses = list
        setWarehouses(list)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load warehouses')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return { warehouses, loading, error }
}
