import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchBinary } from '../api/client'
import { ZOHO_REP_IMAGE_QUERY_VERSION } from '../config/zohoRepImageVersion'
import { getCachedZohoItemBlob, setCachedZohoItemBlob } from '../utils/zohoWeeklyItemImageCache'

const AMAZON_ZOHO_IMAGE_BASE = '/api/amazon/zoho-item-images'

function buildAmazonZohoImagePath(itemId) {
  const q = new URLSearchParams()
  q.set('r', String(ZOHO_REP_IMAGE_QUERY_VERSION))
  return `${AMAZON_ZOHO_IMAGE_BASE}/${encodeURIComponent(String(itemId).trim())}?${q.toString()}`
}

/**
 * Thumbnail for Amazon order/dashboard rows: direct HTTPS (catalog / overrides) or
 * Zoho via authenticated fetch + blob (same pattern as weekly report ZohoItemThumb).
 */
export function AmazonSkuImageThumb({
  imageUrl,
  imageSource,
  zohoItemId,
  imgTitle,
  sizeClass = 'h-10 w-10',
  roundedClass = 'rounded-lg',
}) {
  const [failed, setFailed] = useState(false)
  const [blobSrc, setBlobSrc] = useState(null)
  const objRef = useRef(null)

  const isZoho = imageSource === 'zoho_item' && zohoItemId
  const httpThumb =
    !isZoho && imageUrl && typeof imageUrl === 'string' && imageUrl.trim().toLowerCase().startsWith('http')
      ? imageUrl.trim()
      : null

  useLayoutEffect(() => {
    if (objRef.current) {
      URL.revokeObjectURL(objRef.current)
      objRef.current = null
    }
    setBlobSrc(null)
    setFailed(false)
    if (!isZoho) return undefined

    let cancelled = false
    const go = async () => {
      try {
        const fromMem = getCachedZohoItemBlob(zohoItemId)
        const path = buildAmazonZohoImagePath(zohoItemId)
        const blob = fromMem
          ? fromMem
          : (await fetchBinary(path)).blob
        if (cancelled) return
        if (!fromMem) setCachedZohoItemBlob(zohoItemId, blob)
        const u = URL.createObjectURL(blob)
        if (objRef.current) URL.revokeObjectURL(objRef.current)
        objRef.current = u
        setBlobSrc(u)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    void go()
    return () => {
      cancelled = true
    }
  }, [isZoho, zohoItemId])

  useEffect(
    () => () => {
      if (objRef.current) {
        URL.revokeObjectURL(objRef.current)
        objRef.current = null
      }
    },
    [],
  )

  const showHttp = httpThumb && !failed
  const showBlob = isZoho && blobSrc && !failed

  if (!showHttp && !showBlob) {
    if (isZoho && !failed && !blobSrc) {
      return (
        <div
          className={`flex ${sizeClass} shrink-0 items-center justify-center ${roundedClass} bg-white/5 text-[10px] text-slate-600`}
          aria-hidden
        />
      )
    }
    return (
      <div
        className={`flex ${sizeClass} shrink-0 items-center justify-center ${roundedClass} bg-white/5 text-[10px] text-slate-600`}
        title={imgTitle || undefined}
      >
        —
      </div>
    )
  }

  const src = showBlob ? blobSrc : httpThumb
  return (
    <img
      src={src}
      alt=""
      title={imgTitle || undefined}
      onError={() => setFailed(true)}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={`${sizeClass} shrink-0 ${roundedClass} border border-white/10 bg-white/[0.06] object-contain`}
    />
  )
}
