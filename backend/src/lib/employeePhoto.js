/** Stable API path for employee profile photos stored in S3 (no expiring presigned URL in JSON). */
function employeePhotoApiPath(employeeId) {
  return `/api/employees/${employeeId}/photo`
}

function contentTypeFromS3Key(key) {
  const k = String(key || '').toLowerCase()
  if (k.endsWith('.png')) return 'image/png'
  if (k.endsWith('.webp')) return 'image/webp'
  if (k.endsWith('.gif')) return 'image/gif'
  if (k.endsWith('.jpg') || k.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/jpeg'
}

function isPersistedSignedS3Url(url) {
  const s = String(url || '')
  return s.includes('X-Amz-Signature=') || s.includes('X-Amz-Algorithm=')
}

/** Attach list-safe photo_url for JSON responses. */
function attachEmployeePhotoFields(emp) {
  if (!emp) return emp
  if (emp.photo_doc_key) {
    const path = employeePhotoApiPath(emp.id)
    emp.photo_url = path
    emp.photo_url_signed = path
    return emp
  }
  if (isPersistedSignedS3Url(emp.photo_url)) {
    emp.photo_url = null
    emp.photo_url_signed = null
  }
  return emp
}

module.exports = {
  employeePhotoApiPath,
  contentTypeFromS3Key,
  isPersistedSignedS3Url,
  attachEmployeePhotoFields,
}
