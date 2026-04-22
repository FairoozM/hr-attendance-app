import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  fetchInsightsImageUrls,
  getInsightsImageUploadUrl,
  uploadInsightsImageToS3,
} from '../../lib/influencers'

export const MAX_INSIGHT_IMAGES = 6

/**
 * Upload and manage influencer insights screenshots (S3-backed, max MAX_INSIGHT_IMAGES).
 * Direct-to-S3 presigned uploads, parallel transfer, one PATCH to persist keys.
 */
export function InsightsImagesSection({
  influencerId,
  imageKeys,
  canEdit,
  updateInfluencer,
  className = '',
}) {
  const keys = Array.isArray(imageKeys) ? imageKeys : []
  const keysJoined = keys.join('\0')
  const [signedByKey, setSignedByKey] = useState({})
  const [loadError, setLoadError] = useState(null)
  const [loadingUrls, setLoadingUrls] = useState(false)
  const [busy, setBusy] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  /** S3 key → local blob: for instant preview while the object uploads / signs. */
  const [localPreview, setLocalPreview] = useState({})
  const displayKeys = useMemo(() => {
    const fromLocal = Object.keys(localPreview).filter((k) => !keys.includes(k))
    return fromLocal.length ? [...keys, ...fromLocal] : keys
  }, [keys, localPreview])
  const fileRef = useRef(null)
  const blobRef = useRef(new Set())

  const revokeAllLocal = useCallback(() => {
    blobRef.current.forEach((u) => {
      try {
        URL.revokeObjectURL(u)
      } catch (_) {}
    })
    blobRef.current = new Set()
  }, [])

  useEffect(() => {
    return () => {
      revokeAllLocal()
    }
  }, [revokeAllLocal])

  useEffect(() => {
    let cancelled = false
    if (!keys.length) {
      setSignedByKey({})
      setLoadError(null)
      return undefined
    }
    setLoadingUrls(true)
    setLoadError(null)
    ;(async () => {
      try {
        const items = await fetchInsightsImageUrls(influencerId)
        if (cancelled) return
        const map = {}
        for (const it of items) {
          if (it?.key && it?.url) map[it.key] = it.url
        }
        setSignedByKey(map)
        setLocalPreview((prev) => {
          const next = { ...prev }
          for (const k of Object.keys(next)) {
            if (map[k] && next[k]) {
              try {
                URL.revokeObjectURL(next[k])
                blobRef.current.delete(next[k])
              } catch (_) {}
              delete next[k]
            }
          }
          return next
        })
      } catch (e) {
        if (!cancelled) {
          setSignedByKey({})
          setLoadError(e?.message || 'Could not load images')
        }
      } finally {
        if (!cancelled) setLoadingUrls(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [influencerId, keysJoined])

  const runUploads = useCallback(
    async (fileArray) => {
      const imageFiles = fileArray.filter((f) => f.type && f.type.startsWith('image/'))
      if (!imageFiles.length) return
      const pendingLocal = Object.keys(localPreview).filter((k) => !keys.includes(k)).length
      const used = keys.length + pendingLocal
      const remaining = Math.max(0, MAX_INSIGHT_IMAGES - used)
      if (remaining <= 0) return
      const toAdd = imageFiles.slice(0, remaining)
      setBusy(true)
      const preview = {}
      try {
        const meta = await Promise.all(
          toAdd.map((file) =>
            getInsightsImageUploadUrl(influencerId, {
              fileName: file.name,
              contentType: file.type,
            }),
          ),
        )
        for (let i = 0; i < meta.length; i += 1) {
          const url = URL.createObjectURL(toAdd[i])
          blobRef.current.add(url)
          preview[meta[i].key] = url
        }
        setLocalPreview((p) => ({ ...p, ...preview }))
        await Promise.all(
          meta.map((m, i) => uploadInsightsImageToS3(m.uploadUrl, toAdd[i])),
        )
        const newKeyStrings = meta.map((m) => m.key)
        await updateInfluencer(influencerId, {
          insightsImageKeys: [...keys, ...newKeyStrings],
        })
      } catch (err) {
        setLocalPreview((p) => {
          const n = { ...p }
          for (const k of Object.keys(preview)) {
            if (n[k]) {
              try {
                URL.revokeObjectURL(n[k])
                blobRef.current.delete(n[k])
              } catch (_) {}
              delete n[k]
            }
          }
          return n
        })
        window.alert(err?.message || 'Upload failed')
      } finally {
        setBusy(false)
      }
    },
    [influencerId, keys, localPreview, updateInfluencer],
  )

  const onPickFile = async (e) => {
    const list = e.target.files
    e.target.value = ''
    if (!list?.length) return
    await runUploads([...list])
  }

  const onRemove = async (removeKey) => {
    if (!canEdit || busy) return
    if (!keys.includes(removeKey) && localPreview[removeKey]) {
      setLocalPreview((p) => {
        const n = { ...p }
        if (n[removeKey]) {
          try {
            URL.revokeObjectURL(n[removeKey])
            blobRef.current.delete(n[removeKey])
          } catch (_) {}
          delete n[removeKey]
        }
        return n
      })
      return
    }
    setBusy(true)
    try {
      setLocalPreview((p) => {
        if (p[removeKey]) {
          try {
            URL.revokeObjectURL(p[removeKey])
            blobRef.current.delete(p[removeKey])
          } catch (_) {}
        }
        const n = { ...p }
        delete n[removeKey]
        return n
      })
      await updateInfluencer(influencerId, {
        insightsImageKeys: keys.filter((k) => k !== removeKey),
      })
    } catch (err) {
      window.alert(err?.message || 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  const onDragOver = (e) => {
    if (!canEdit || busy || displayKeys.length >= MAX_INSIGHT_IMAGES) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    if (e.dataTransfer?.types?.includes('Files')) setIsDragging(true)
  }

  const onDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget?.contains(e.relatedTarget)) setIsDragging(false)
  }

  const onDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (!canEdit || busy || displayKeys.length >= MAX_INSIGHT_IMAGES) return
    const dt = e.dataTransfer
    if (!dt?.files?.length) return
    await runUploads([...dt.files])
  }

  return (
    <div className={`inf-insights-images-wrap ${className}`.trim()}>
      <div
        className={`inf-profile-section inf-profile-section--full inf-insights-images${
          isDragging ? ' inf-insights-images--dropping' : ''
        }`}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        role="presentation"
      >
        <div className="inf-profile-section__head">
          <span className="inf-profile-section__head-icon">🖼️</span>
          <span className="inf-profile-section__head-title">Insights images</span>
        </div>
        <div className="inf-profile-section__body">
          <p className="inf-insights-images__intro">
            Add multiple screenshots at once (up to {MAX_INSIGHT_IMAGES} total). Files upload directly to secure
            storage for speed—drop files here or use the button. Only users with influencer access can view them.
          </p>
          <div className="inf-insights-images__toolbar">
            <span className="inf-insights-images__hint">
              {displayKeys.length}/{MAX_INSIGHT_IMAGES} used
              {loadingUrls && displayKeys.length > 0 ? ' · Loading…' : ''}
            </span>
            {canEdit && displayKeys.length < MAX_INSIGHT_IMAGES && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="inf-insights-images__file"
                  aria-label="Upload insights images"
                  onChange={onPickFile}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="inf-btn inf-btn--primary inf-btn--sm"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy ? 'Uploading…' : 'Add images'}
                </button>
              </>
            )}
          </div>
          {loadError && <p className="inf-insights-images__err">{loadError}</p>}
          {isDragging && (
            <p className="inf-insights-images__drop-prompt" aria-hidden>
              Drop images to upload
            </p>
          )}
          {!displayKeys.length && !loadError && (
            <p className="inf-insights-images__empty">No insights images yet.</p>
          )}
          {displayKeys.length > 0 && (
            <div className="inf-insights-images__grid">
              {displayKeys.map((key) => {
                const url = signedByKey[key] || localPreview[key]
                return (
                  <div key={key} className="inf-insights-images__cell">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inf-insights-images__link"
                      >
                        <img src={url} alt="Insights" loading="lazy" />
                      </a>
                    ) : (
                      <div className="inf-insights-images__placeholder" />
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        className="inf-insights-images__remove"
                        aria-label="Remove image"
                        disabled={busy}
                        onClick={() => onRemove(key)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
