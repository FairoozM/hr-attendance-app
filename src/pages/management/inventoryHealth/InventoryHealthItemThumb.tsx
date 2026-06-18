import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { resolveApiUrl } from '../../../api/client'

type InventoryHealthItemThumbProps = {
  imageUrl?: string | null
  imageMissing?: boolean
  itemId?: string
  itemName?: string
  sku?: string
}

function initials(itemName?: string, sku?: string) {
  const source = (itemName || sku || '').trim()
  if (!source) return '—'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export function InventoryHealthItemThumb({ imageUrl, imageMissing, itemId, itemName, sku }: InventoryHealthItemThumbProps) {
  const [failed, setFailed] = useState(false)
  const path = imageUrl && imageUrl.trim() ? imageUrl.trim() : null
  const src = path ? resolveApiUrl(path) : null

  if (src && !failed) {
    return (
      <div className="ih-thumb-wrap">
        <img
          src={src}
          alt=""
          title={itemName || sku || itemId || undefined}
          loading="lazy"
          decoding="async"
          className="ih-thumb-img"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }

  const title = imageMissing !== false && !path
    ? itemName || sku || itemId || 'No image cached — run Sync next 100 missing images'
    : failed
      ? 'Cached image failed to load'
      : itemName || sku || itemId || undefined

  return (
    <div
      className={`ih-thumb-placeholder${failed ? ' ih-thumb-placeholder--failed' : ''}`}
      title={title}
      aria-hidden
    >
      {failed && path ? <ImageOff size={20} strokeWidth={1.75} className="ih-thumb-icon" /> : null}
      {!failed && (imageMissing !== false || !path) ? initials(itemName, sku) : null}
    </div>
  )
}
