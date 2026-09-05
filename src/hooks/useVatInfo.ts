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

export type VatCertificate = {
  id: string
  vatInfoId: string
  fileName: string
  fileType: string
  fileSize: number | null
  uploadedBy: string | null
  uploadedAt: string | null
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
  certificates: VatCertificate[]
  createdAt: string | null
  updatedAt: string | null
}

type VatCertificateApiRow = {
  id: number | string
  vat_info_id?: number | string | null
  file_name?: string | null
  file_type?: string | null
  file_size?: number | string | null
  uploaded_by?: number | string | null
  uploaded_at?: string | null
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
  certificates?: VatCertificateApiRow[] | null
  created_at?: string | null
  updated_at?: string | null
}

function toDateInput(value: string | null | undefined): string | null {
  if (!value) return null
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s
}

function mapCertificate(row: VatCertificateApiRow, fallbackVatId?: string): VatCertificate {
  return {
    id: String(row.id),
    vatInfoId: String(row.vat_info_id ?? fallbackVatId ?? ''),
    fileName: row.file_name ?? '',
    fileType: row.file_type ?? '',
    fileSize: row.file_size == null ? null : Number(row.file_size),
    uploadedBy: row.uploaded_by == null ? null : String(row.uploaded_by),
    uploadedAt: row.uploaded_at ?? null,
  }
}

function mapVatInfo(row: VatInfoApiRow): VatInfoItem {
  const countryRaw = String(row.country || '').toUpperCase()
  const country: VatCountry = countryRaw === 'KSA' ? 'KSA' : 'UAE'
  const id = String(row.id)
  return {
    id,
    companyName: row.company_name ?? '',
    vatNumber: row.vat_number ?? '',
    country,
    dateFirstRegistered: toDateInput(row.date_first_registered),
    vatPct: Number(row.vat_pct ?? 0),
    vatFilings: row.vat_filings ?? 'Quarterly',
    agent: row.agent ?? '',
    chargesOfFiling: Number(row.charges_of_filing ?? 0),
    certificates: Array.isArray(row.certificates)
      ? row.certificates.map((c) => mapCertificate(c, id))
      : [],
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

  const uploadCertificate = useCallback(async (vatInfoId: string, file: File) => {
    const { uploadUrl, s3Key } = (await api.post(`/api/vat-info/${vatInfoId}/certificates/upload-url`, {
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      fileSize: file.size,
    })) as { uploadUrl: string; s3Key: string }

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    })
    if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`)

    const saved = (await api.post(`/api/vat-info/${vatInfoId}/certificates`, {
      s3Key,
      fileName: file.name,
      fileType: file.type || '',
      fileSize: file.size,
    })) as VatCertificateApiRow

    const mapped = mapCertificate(saved, vatInfoId)
    setItems((prev) =>
      prev.map((row) =>
        row.id === String(vatInfoId)
          ? { ...row, certificates: [...row.certificates, mapped] }
          : row
      )
    )
    return mapped
  }, [])

  const getCertificateDownloadUrl = useCallback(async (vatInfoId: string, certificateId: string) => {
    const result = (await api.get(
      `/api/vat-info/${vatInfoId}/certificates/${certificateId}/download-url`
    )) as { downloadUrl?: string; file_name?: string; fileName?: string }
    if (!result?.downloadUrl) throw new Error('Download URL unavailable')
    return {
      downloadUrl: result.downloadUrl,
      fileName: result.file_name || result.fileName || 'certificate',
    }
  }, [])

  const deleteCertificate = useCallback(async (vatInfoId: string, certificateId: string) => {
    await api.delete(`/api/vat-info/${vatInfoId}/certificates/${certificateId}`)
    setItems((prev) =>
      prev.map((row) =>
        row.id === String(vatInfoId)
          ? {
              ...row,
              certificates: row.certificates.filter((c) => c.id !== String(certificateId)),
            }
          : row
      )
    )
  }, [])

  return {
    items,
    loading,
    error,
    createItem,
    updateItem,
    deleteItem,
    uploadCertificate,
    getCertificateDownloadUrl,
    deleteCertificate,
    refetch: fetchAll,
  }
}
