import { memo, useEffect, useState } from 'react'
import { initialsFromName } from './employeeUtils'
import './EmployeeAvatar.css'

function looksLikeTemporaryS3SignedUrl(url) {
  const s = String(url || '')
  return s.includes('X-Amz-Signature=') || s.includes('X-Amz-Algorithm=')
}

function debugPhotoLog(message, data) {
  if (!import.meta.env.DEV) return
  // #region agent log
  fetch('http://127.0.0.1:7489/ingest/c517718a-1370-451d-8743-105c507e2000', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '0027ca' },
    body: JSON.stringify({
      sessionId: '0027ca',
      location: 'EmployeeAvatar.jsx',
      message,
      data,
      timestamp: Date.now(),
      hypothesisId: 'H4',
    }),
  }).catch(() => {})
  // #endregion
}

export const EmployeeAvatar = memo(function EmployeeAvatar({ name, photoUrl, size = 'md', employeeId }) {
  const [imgFailed, setImgFailed] = useState(false)
  const initial = initialsFromName(name || '')

  useEffect(() => {
    setImgFailed(false)
  }, [photoUrl])

  const showImage = Boolean(photoUrl && !imgFailed)
  const className = `employee-avatar employee-avatar--${size}${showImage ? ' employee-avatar--image' : ''}`

  if (showImage) {
    return (
      <span className={className}>
        <img
          src={photoUrl}
          alt=""
          className="employee-avatar__img"
          width={size === 'sm' ? 32 : 40}
          height={size === 'sm' ? 32 : 40}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          onLoad={() => {
            debugPhotoLog('avatar_load_ok', { employeeId, urlKind: looksLikeTemporaryS3SignedUrl(photoUrl) ? 'signed' : 'plain' })
          }}
          onError={() => {
            setImgFailed(true)
            debugPhotoLog('avatar_load_failed', {
              employeeId,
              urlKind: looksLikeTemporaryS3SignedUrl(photoUrl) ? 'signed' : 'plain',
            })
          }}
        />
      </span>
    )
  }

  return (
    <span className={className} aria-hidden>
      <span className="employee-avatar__fallback">{initial}</span>
    </span>
  )
})
