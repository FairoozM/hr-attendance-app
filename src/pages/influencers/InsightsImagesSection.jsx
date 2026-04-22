import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  GripVertical,
  Eye,
  RotateCw,
  Trash2,
  ImagePlus,
  Info,
} from 'lucide-react'
import {
  fetchInsightsImageUrls,
  getInsightsImageUploadUrl,
  uploadInsightsImageToS3,
  guessImageContentType,
} from '../../lib/influencers'

export const MAX_INSIGHT_IMAGES = 6

/**
 * Product-style 6-capacity insights grid: presigned S3, reorder, rotation metadata, delete all.
 */
export function InsightsImagesSection({
  influencerId,
  imageKeys,
  imageRotations: imageRotationsProp = {},
  canEdit,
  updateInfluencer,
  className = '',
}) {
  const keys = Array.isArray(imageKeys) ? imageKeys : []
  const imageRotations = useMemo(
    () => (imageRotationsProp && typeof imageRotationsProp === 'object' ? imageRotationsProp : {}),
    [imageRotationsProp],
  )

  const keysJoined = keys.join('\0')
  const [signedByKey, setSignedByKey] = useState({})
  const [loadError, setLoadError] = useState(null)
  const [loadingUrls, setLoadingUrls] = useState(false)
  const [busy, setBusy] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [localPreview, setLocalPreview] = useState({})
  const [dragKey, setDragKey] = useState(null)
  const fileRef = useRef(null)
  const blobRef = useRef(new Set())

  const displayKeys = useMemo(() => {
    const fromLocal = Object.keys(localPreview).filter((k) => !keys.includes(k))
    return fromLocal.length ? [...keys, ...fromLocal] : keys
  }, [keys, localPreview])

  const persistRotations = useCallback(
    (next) => {
      if (!influencerId) return
      return updateInfluencer(influencerId, { insightsImageRotations: next })
    },
    [influencerId, updateInfluencer],
  )

  const persistKeys = useCallback(
    async (newKeys, rotationsPatch) => {
      if (!influencerId) return
      const r =
        rotationsPatch != null
          ? rotationsPatch
          : (() => {
              const m = { ...imageRotations }
              for (const k of Object.keys(m)) {
                if (!newKeys.includes(k)) delete m[k]
              }
              return m
            })()
      await updateInfluencer(influencerId, {
        insightsImageKeys: newKeys,
        insightsImageRotations: r,
      })
    },
    [influencerId, updateInfluencer, imageRotations],
  )

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
      const imageFiles = fileArray.filter(
        (f) =>
          f.type &&
          (f.type.startsWith('image/') ||
            /(\.jpe?g|\.png|\.webp|\.gif|\.heic|\.heif|\.avif)$/i.test(f.name || '')),
      )
      if (!imageFiles.length) {
        return
      }
      const pendingLocal = Object.keys(localPreview).filter((k) => !keys.includes(k)).length
      const used = keys.length + pendingLocal
      const remaining = Math.max(0, MAX_INSIGHT_IMAGES - used)
      if (remaining <= 0) {
        return
      }
      const toAdd = imageFiles.slice(0, remaining)
      setBusy(true)
      const preview = {}
      const meta = []
      try {
        for (const file of toAdd) {
          const contentType = guessImageContentType(file)
          const m = await getInsightsImageUploadUrl(influencerId, {
            fileName: file.name && file.name.trim() ? file.name : 'image.jpg',
            contentType,
          })
          meta.push({ ...m, contentType, file })
        }
        for (let i = 0; i < meta.length; i += 1) {
          const u = URL.createObjectURL(meta[i].file)
          blobRef.current.add(u)
          preview[meta[i].key] = u
        }
        setLocalPreview((p) => ({ ...p, ...preview }))
        await Promise.all(
          meta.map((m) => uploadInsightsImageToS3(m.uploadUrl, m.file, m.contentType)),
        )
        const newKeyStrings = meta.map((m) => m.key)
        await updateInfluencer(influencerId, {
          insightsImageKeys: [...keys, ...newKeyStrings],
          insightsImageRotations: imageRotations,
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
    [influencerId, keys, localPreview, updateInfluencer, imageRotations],
  )

  const onPickFile = async (e) => {
    const list = e.target.files
    e.target.value = ''
    if (!list?.length) {
      return
    }
    await runUploads([...list])
  }

  const onDeleteOne = async (removeKey) => {
    if (!canEdit || busy) {
      return
    }
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
      const newKeys = keys.filter((k) => k !== removeKey)
      const nextR = { ...imageRotations }
      delete nextR[removeKey]
      await updateInfluencer(influencerId, {
        insightsImageKeys: newKeys,
        insightsImageRotations: nextR,
      })
    } catch (err) {
      window.alert(err?.message || 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  const onDeleteAll = async () => {
    if (!canEdit || busy || !keys.length) {
      return
    }
    if (!window.confirm('Remove all insights images? This cannot be undone.')) {
      return
    }
    setBusy(true)
    try {
      setLocalPreview({})
      await updateInfluencer(influencerId, {
        insightsImageKeys: [],
        insightsImageRotations: {},
      })
    } catch (err) {
      window.alert(err?.message || 'Failed to clear images')
    } finally {
      setBusy(false)
    }
  }

  const onRotate = async (k) => {
    if (!canEdit || busy) {
      return
    }
    const cur = (imageRotations[k] || 0) % 360
    const next = (cur + 90) % 360
    try {
      await persistRotations({ ...imageRotations, [k]: next })
    } catch (e) {
      window.alert(e?.message || 'Could not save rotation')
    }
  }

  const onDragOverGrid = (e) => {
    if (!canEdit || busy) {
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDropFile = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (!canEdit || busy) {
      return
    }
    if (e.dataTransfer?.files?.length) {
      void runUploads([...e.dataTransfer.files])
    }
  }

  const onKeyDragStart = (e, key) => {
    if (!canEdit) {
      return
    }
    e.dataTransfer.setData('text/plain', key)
    e.dataTransfer.effectAllowed = 'move'
    setDragKey(key)
  }

  const onKeyDragEnd = () => {
    setDragKey(null)
  }

  const onKeyDragOver = (e) => {
    e.preventDefault()
    if (e.dataTransfer?.types?.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
    } else {
      e.dataTransfer.dropEffect = 'move'
    }
  }

  const onKeyDropOnCell = async (e, targetKey) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer?.files?.length) {
      setIsDragging(false)
      await runUploads([...e.dataTransfer.files])
      return
    }
    if (!canEdit) {
      return
    }
    const fromK = e.dataTransfer.getData('text/plain') || dragKey
    if (!fromK || fromK === targetKey) {
      return
    }
    if (!keys.includes(fromK) || !keys.includes(targetKey)) {
      return
    }
    const a = [...keys]
    const fromI = a.indexOf(fromK)
    const toI = a.indexOf(targetKey)
    if (fromI < 0 || toI < 0) {
      return
    }
    a.splice(fromI, 1)
    a.splice(toI, 0, fromK)
    setDragKey(null)
    setBusy(true)
    try {
      await persistKeys(a, imageRotations)
    } catch (err) {
      window.alert(err?.message || 'Reorder failed')
    } finally {
      setBusy(false)
    }
  }

  const previewKey = (k) => {
    const u = signedByKey[k] || localPreview[k]
    if (u) {
      window.open(u, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className={`inf-prod-images-wrap ${className}`.trim()}>
      <div className="inf-prod-images">
        <div className="inf-prod-images__head">
          <h3 className="inf-prod-images__title">
            <span>Insights images</span>
            <span className="inf-prod-images__info" title="Max 6 images, stored in your secure bucket. Reorder, rotate, or remove before they go live.">
              <Info size={14} aria-hidden />
            </span>
          </h3>
          <p className="inf-prod-images__sub">
            Add images to share influencer insights. You can reorder, rotate, or remove each image before they are saved to your library.
            {loadingUrls && displayKeys.length > 0 ? ' Loading previews…' : null}
          </p>
        </div>

        <div
          className={`inf-prod-images__grid${isDragging ? ' inf-prod-images__grid--dropping' : ''}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types?.includes('Files')) {
              return
            }
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            if (canEdit && displayKeys.length < MAX_INSIGHT_IMAGES) {
              setIsDragging(true)
            }
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDropFile}
        >
          {canEdit && displayKeys.length < MAX_INSIGHT_IMAGES && (
            <button
              type="button"
              className="inf-prod-images__add"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              onDragOver={onDragOverGrid}
            >
              <div className="inf-prod-images__add-icon">
                <ImagePlus size={24} />
              </div>
              <span className="inf-prod-images__add-title">Add images</span>
              <span className="inf-prod-images__add-hint">You can select multiple at once</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                className="inf-prod-sr"
                aria-label="Add insights images"
                onChange={onPickFile}
                disabled={busy}
              />
            </button>
          )}

          {displayKeys.map((k) => {
            const url = signedByKey[k] || localPreview[k]
            const deg = (imageRotations[k] || 0) % 360
            const isPersisted = keys.includes(k)
            return (
              <div
                key={k}
                className="inf-prod-images__cell"
                onDragOver={onKeyDragOver}
                onDrop={(e) => onKeyDropOnCell(e, k)}
              >
                {url ? (
                  <div className="inf-prod-images__thumb" style={{ transform: `rotate(${deg}deg)` }}>
                    <img src={url} alt="" role="presentation" />
                  </div>
                ) : (
                  <div className="inf-prod-images__skeleton" />
                )}
                {canEdit && (
                  <div className="inf-prod-images__toolbar" onClick={(e) => e.stopPropagation()}>
                    {isPersisted && (
                      <span
                        className="inf-prod-images__tool"
                        title="Drag to reorder"
                        draggable
                        onDragStart={(e) => onKeyDragStart(e, k)}
                        onDragEnd={onKeyDragEnd}
                        role="button"
                        tabIndex={0}
                        aria-label="Drag to reorder"
                      >
                        <GripVertical size={16} />
                      </span>
                    )}
                    {url && (
                      <button
                        type="button"
                        className="inf-prod-images__tool"
                        title="Open full size"
                        onClick={() => previewKey(k)}
                      >
                        <Eye size={16} />
                      </button>
                    )}
                    {isPersisted && url && (
                      <button
                        type="button"
                        className="inf-prod-images__tool"
                        title="Rotate 90°"
                        onClick={() => onRotate(k)}
                        disabled={busy}
                      >
                        <RotateCw size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="inf-prod-images__tool inf-prod-images__tool--del"
                      title="Remove"
                      onClick={() => onDeleteOne(k)}
                      disabled={busy}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {loadError && <p className="inf-prod-images__err">{loadError}</p>}

        {canEdit && keys.length > 0 && (
          <div className="inf-prod-images__footer">
            <button
              type="button"
              className="inf-prod-images__delete-all"
              onClick={onDeleteAll}
              disabled={busy}
            >
              <Trash2 size={16} />
              Delete all images
            </button>
            <span className="inf-prod-images__count" aria-live="polite">
              {displayKeys.length} / {MAX_INSIGHT_IMAGES} images
            </span>
          </div>
        )}
        {!canEdit && displayKeys.length > 0 && (
          <p className="inf-prod-images__ro-hint" role="status">
            View only — {displayKeys.length} {displayKeys.length === 1 ? 'image' : 'images'}
          </p>
        )}
      </div>
    </div>
  )
}
