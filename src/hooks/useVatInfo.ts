import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'

export type VatCountry = 'UAE' | 'KSA'

export type VatInfoForm = {
  companyName: string
  vatNumber: string
  country: VatCountry
  dateFirstRegistered: string
  vatPct: string
  vatFilings: string
  agent: string
  chargesOfFiling: string
}

export type VatInfoItem = {
  id: string
  companyName: string
  vatNumber: string
  country: VatCountry
  dateFirstRegistered: string | null
  vatPct: number
  vatFilings: string
  agent: string
  chargesOfFiling: number
  createdAt: string | null
  updatedAt: string | null
}

type VatInfoApiRow = {
  id: number | string
  company_name?: string | null
  vat_number?: string | null
  country?: string | null
  date_first_registered?: string | null
  vat_pct?: number | string | null
  vat_filings?: string | null
  agent?: string | null
  charges_of_filing?: number | string | null
  created_at?: string | null
  updated_at?: string | null
}

function toDateInput(value: string | null | undefined): string | null {
  if (!value) return null
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s
}

function mapVatInfo(row: VatInfoApiRow): VatInfoItem {
  const countryRaw = String(row.country || '').toUpperCase()
  const country: VatCountry = countryRaw === 'KSA' ? 'KSA' : 'UAE'
  return {
    id: String(row.id),
    companyName: row.company_name ?? '',
    vatNumber: row.vat_number ?? '',
    country,
    dateFirstRegistered: toDateInput(row.date_first_registered),
    vatPct: Number(row.vat_pct ?? 0),
    vatFilings: row.vat_filings ?? 'Quarterly',
    agent: row.agent ?? '',
    chargesOfFiling: Number(row.charges_of_filing ?? 0),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

function toPayload(form: VatInfoForm) {
  return {
    company_name: String(form.companyName || '').trim(),
    vat_number: String(form.vatNumber || '').trim(),
    country: String(form.country || '').trim(),
    date_first_registered: String(form.dateFirstRegistered || '').trim() || null,
    vat_pct: Number(form.vatPct || 0),
    vat_filings: String(form.vatFilings || '').trim() || 'Quarterly',
    agent: String(form.agent || '').trim(),
    charges_of_filing: Number(form.chargesOfFiling || 0),
  }
}

export function useVatInfo() {
  const [items, setItems] = useState<VatInfoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.get('/api/vat-info')
      setItems(Array.isArray(data) ? data.map(mapVatInfo) : [])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load VAT info list'
      setError(message)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const createItem = useCallback(async (form: VatInfoForm) => {
    const created = await api.post('/api/vat-info', toPayload(form))
    setItems((prev) => [...prev, mapVatInfo(created as VatInfoApiRow)])
  }, [])

  const updateItem = useCallback(async (id: string, form: VatInfoForm) => {
    const updated = await api.put(`/api/vat-info/${id}`, toPayload(form))
    setItems((prev) =>
      prev.map((row) => (row.id === String(id) ? mapVatInfo(updated as VatInfoApiRow) : row))
    )
  }, [])

  const deleteItem = useCallback(async (id: string) => {
    await api.delete(`/api/vat-info/${id}`)
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
