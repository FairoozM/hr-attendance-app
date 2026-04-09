import { useState, useCallback, useEffect } from 'react'
import { api } from '../api/client'

export function useProfile() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get('/api/profile')
      setProfile(data)
    } catch (err) {
      setError(err.message || 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const update = useCallback(async (data) => {
    const updated = await api.put('/api/profile', data)
    setProfile(updated)
    return updated
  }, [])

  return { profile, loading, error, load, update, setProfile }
}

export async function uploadProfileDoc(docType, file) {
  // 1. Get presigned upload URL
  const { uploadUrl, key } = await api.post('/api/profile/doc-upload-url', {
    docType,
    fileName: file.name,
    contentType: file.type,
    fileSize: file.size,
  })

  // 2. Upload file directly to S3
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })
  if (!uploadRes.ok) {
    throw new Error(`S3 upload failed (HTTP ${uploadRes.status})`)
  }

  // 3. Confirm and persist the key
  const confirmed = await api.post('/api/profile/doc-confirm', { docType, key })
  return confirmed
}

export async function deleteProfileDoc(docType) {
  await api.delete(`/api/profile/doc/${docType}`)
}

/** Fetch an employee's full profile (admin use) */
export async function fetchEmployeeProfile(employeeId) {
  return api.get(`/api/employees/${employeeId}/profile`)
}
