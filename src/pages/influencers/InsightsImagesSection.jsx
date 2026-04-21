import { useState, useEffect, useRef } from 'react'
import {
  fetchInsightsImageUrls,
  getInsightsImageUploadUrl,
  uploadInsightsImageToS3,
} from '../../lib/influencers'

export const MAX_INSIGHT_IMAGES = 6

/**
 * Upload and manage influencer insights screenshots (S3-backed, max MAX_INSIGHT_IMAGES).
 * Used on profile view and Add/Edit wizard.
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
  const fileRef = useRef(null)

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

  const onPickFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !file.type.startsWith('image/')) return
    if (keys.length >= MAX_INSIGHT_IMAGES) return
    setBusy(true)
    try {
      const { uploadUrl, key } = await getInsightsImageUploadUrl(influencerId, {
        fileName: file.name,
        contentType: file.type,
      })
      await uploadInsightsImageToS3(uploadUrl, file)
      await updateInfluencer(influencerId, { insightsImageKeys: [...keys, key] })
    } catch (err) {
      window.alert(err?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async (removeKey) => {
    if (!canEdit || busy) return
    setBusy(true)
    try {
      await updateInfluencer(influencerId, {
        insightsImageKeys: keys.filter((k) => k !== removeKey),
      })
    } catch (err) {
      window.alert(err?.message || 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`inf-insights-images-wrap ${className}`.trim()}>
      <div className="inf-profile-section inf-profile-section--full inf-insights-images">
        <div className="inf-profile-section__head">
          <span className="inf-profile-section__head-icon">🖼️</span>
          <span className="inf-profile-section__head-title">Insights images</span>
        </div>
        <div className="inf-profile-section__body">
          <p className="inf-insights-images__intro">
            Upload screenshots or exports for this influencer&apos;s insights (max {MAX_INSIGHT_IMAGES} images).
            Images are stored securely and shown only to users with influencer access.
          </p>
          <div className="inf-insights-images__toolbar">
            <span className="inf-insights-images__hint">
              {keys.length}/{MAX_INSIGHT_IMAGES} used
              {loadingUrls && keys.length > 0 ? ' · Loading…' : ''}
            </span>
            {canEdit && keys.length < MAX_INSIGHT_IMAGES && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="inf-insights-images__file"
                  aria-label="Upload insights image"
                  onChange={onPickFile}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="inf-btn inf-btn--primary inf-btn--sm"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  {busy ? 'Uploading…' : 'Add image'}
                </button>
              </>
            )}
          </div>
          {loadError && <p className="inf-insights-images__err">{loadError}</p>}
          {!keys.length && !loadError && (
            <p className="inf-insights-images__empty">No insights images yet.</p>
          )}
          {keys.length > 0 && (
            <div className="inf-insights-images__grid">
              {keys.map((key) => {
                const url = signedByKey[key]
                return (
                  <div key={key} className="inf-insights-images__cell">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="inf-insights-images__link">
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
