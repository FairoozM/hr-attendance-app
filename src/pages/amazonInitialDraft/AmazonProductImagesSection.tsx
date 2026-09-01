import { useMemo, useState } from 'react'

import type { ImagePreview, ImageRecord, ImageSkuGroup } from '../../api/amazonInitialDraft'

export type ImageFilter =
  | 'all'
  | 'ready'
  | 'missing-main'
  | 'unmatched'
  | 'ambiguous'
  | 'duplicate'
  | 'website-missing'
  | 'conflicts'
  | 'warnings'

const IMAGE_FILTERS: Array<{ id: ImageFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready' },
  { id: 'missing-main', label: 'Missing main image' },
  { id: 'unmatched', label: 'Unmatched files' },
  { id: 'ambiguous', label: 'Ambiguous' },
  { id: 'duplicate', label: 'Duplicate positions' },
  { id: 'website-missing', label: 'No WEBSITE images' },
  { id: 'conflicts', label: 'Conflicts' },
  { id: 'warnings', label: 'Warnings' },
]

const CARD = 'rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md'
const STAT = 'rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm'

/** Why the configuration is incomplete, in words an operator can act on. */
const CONFIGURATION_HELP: Record<string, string> = {
  'public-base-url-not-configured':
    'Set AMAZON_IMAGE_PUBLIC_BASE_URL to the CloudFront domain that serves the delivery prefix. Until then no image URL is produced.',
  'public-base-url-must-be-https': 'AMAZON_IMAGE_PUBLIC_BASE_URL must be an https:// CloudFront domain.',
  'source-bucket-not-configured': 'Set AMAZON_IMAGE_SOURCE_BUCKET to the approved marketplace-images bucket.',
  'source-roots-not-configured': 'Set AMAZON_IMAGE_SOURCE_ROOTS to the approved source prefixes.',
  'delivery-bucket-not-configured': 'Set AMAZON_IMAGE_DELIVERY_BUCKET to the public delivery bucket.',
  'delivery-prefix-not-configured': 'Set AMAZON_IMAGE_DELIVERY_PREFIX to the public delivery prefix.',
  'batch-prefix-required': 'Choose an approved image batch before analysing the template.',
  'batch-prefix-outside-allowed-root': 'That batch folder is outside the approved marketplace-image area.',
  'batch-prefix-traversal': 'That batch folder is outside the approved marketplace-image area.',
}

function statusTone(status: string): string {
  if (status === 'ready') return 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30'
  if (
    status === 'unmatched-filename' ||
    status === 'delivery-copy-failed' ||
    status === 'public-url-unreachable' ||
    status === 'time-budget-reached'
  ) {
    return 'bg-rose-500/15 text-rose-200 ring-rose-400/30'
  }
  return 'bg-amber-500/15 text-amber-200 ring-amber-400/30'
}

function Pill({ children, tone }: { children: string; tone: string }) {
  return (
    <span className={`inline-flex rounded-lg px-2 py-0.5 text-[11px] font-semibold ring-1 ${tone}`}>{children}</span>
  )
}

function Stat({ label, value, tone = 'text-white' }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className={STAT}>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  )
}

/**
 * One image tile. The thumbnail is the permanent public URL, which is exactly what Amazon
 * will fetch, so a broken tile here is a broken URL in the workbook.
 */
function ImageTile({ record }: { record: ImageRecord }) {
  const [failed, setFailed] = useState(false)
  const label = record.classification === 'main' ? 'Main' : `Image ${record.detectedPosition}`

  return (
    <figure className="flex w-40 flex-col gap-2" data-testid="image-tile">
      <div className="relative flex h-40 w-40 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/30">
        {record.publicUrl && !failed ? (
          <img
            src={record.publicUrl}
            alt={`${record.sku} ${label}`}
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="px-2 text-center text-[11px] font-semibold text-slate-500">
            {record.publicUrl ? 'Preview unavailable' : 'No delivery URL'}
          </span>
        )}
        <span className="absolute left-2 top-2 rounded-lg bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-200">
          {label}
        </span>
      </div>

      <figcaption className="flex flex-col gap-1">
        <Pill tone={statusTone(record.status)}>{record.populationStatus || record.status}</Pill>
        <span className="break-all text-[11px] leading-snug text-slate-400" title={record.filename}>
          {record.filename}
        </span>
        {record.width && record.height ? (
          <span className="text-[10px] text-slate-500">
            {record.width}×{record.height} · {(record.sourceSize / 1024 / 1024).toFixed(1)} MB
          </span>
        ) : null}
        {record.publicUrl ? (
          <a
            href={record.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all text-[10px] text-sky-300 hover:text-sky-200"
          >
            {record.publicUrl}
          </a>
        ) : null}
        {record.warning ? <span className="text-[10px] leading-snug text-amber-300">{record.warning}</span> : null}
      </figcaption>
    </figure>
  )
}

function recordMatchesFilter(record: ImageRecord, filter: ImageFilter): boolean {
  switch (filter) {
    case 'ready':
      return record.status === 'ready'
    case 'unmatched':
      return record.status === 'unmatched-filename' || record.status === 'unsupported-file'
    case 'ambiguous':
      return record.status === 'ambiguous-sku'
    case 'duplicate':
      return record.status.startsWith('duplicate-position')
    case 'website-missing':
      return record.status === 'website-images-missing' || record.status === 'noon-not-used'
    case 'conflicts':
      return record.populationStatus === 'existing-value-preserved'
    case 'warnings':
      return Boolean(record.warning) || record.status === 'unsupported-position'
    default:
      return true
  }
}

function groupMatchesFilter(group: ImageSkuGroup, filter: ImageFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'missing-main') return !group.hasMainImage
  if (filter === 'website-missing' && group.websiteImagesMissing) return true
  if (filter === 'ready') return group.hasMainImage && group.problems.length === 0
  const records = [group.main, ...group.secondary, ...group.problems].filter(Boolean) as ImageRecord[]
  return records.some((record) => recordMatchesFilter(record, filter))
}

export default function AmazonProductImagesSection({ images }: { images: ImagePreview | undefined }) {
  const [filter, setFilter] = useState<ImageFilter>('all')
  const [search, setSearch] = useState('')

  const groups = useMemo(() => {
    if (!images) return []
    const needle = search.trim().toLowerCase()
    return images.skus.filter((group) => {
      if (!groupMatchesFilter(group, filter)) return false
      if (!needle) return true
      return group.sku.toLowerCase().includes(needle) || group.productName.toLowerCase().includes(needle)
    })
  }, [images, filter, search])

  const unassigned = useMemo(() => {
    if (!images) return []
    return images.unassigned.filter((record) => recordMatchesFilter(record, filter))
  }, [images, filter])

  if (!images || !images.enabled) return null

  const summary = images.summary
  const help = images.error ? CONFIGURATION_HELP[images.error] : null

  return (
    <section className={CARD} data-testid="amazon-product-images">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Amazon Product Images</h2>
          <p className="mt-1 text-sm text-slate-400">
            Approved JPEGs from{' '}
            <span className="font-semibold text-slate-200">
              {images.sourceBucket}/{images.batchPrefix || '—'}
            </span>
            , copied byte-for-byte to a permanent public location. Nothing is resized, recompressed or deleted, and
            website images are never used.
          </p>
        </div>
        {images.publicBaseUrl ? (
          <p className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-slate-400">
            Delivery domain
            <span className="ml-2 font-semibold text-slate-200">{images.publicBaseUrl}</span>
          </p>
        ) : null}
      </div>

      {images.error ? (
        <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          <p className="font-semibold">Image matching did not run: {images.error}</p>
          {help ? <p className="mt-1 text-rose-200/80">{help}</p> : null}
          <p className="mt-1 text-rose-200/80">
            The rest of the draft was generated normally and every image cell was left exactly as uploaded.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Stat label="Source files" value={summary.sourceFiles} tone="text-sky-300" />
            <Stat label="SKU matches" value={summary.matchedFiles} tone="text-emerald-300" />
            <Stat label="SKUs with main" value={summary.skusWithMainImage} tone="text-emerald-300" />
            <Stat label="Missing main" value={summary.skusMissingMainImage} tone="text-amber-300" />
            <Stat label="Secondary images" value={summary.secondaryImages} tone="text-sky-300" />
            <Stat label="Unmatched files" value={summary.unmatchedFiles} tone="text-rose-300" />
            <Stat label="Ambiguous" value={summary.ambiguousFiles} tone="text-amber-300" />
            <Stat label="Duplicate positions" value={summary.duplicatePositions} tone="text-amber-300" />
            <Stat label="No WEBSITE images" value={summary.skusWithoutWebsiteImages} tone="text-amber-300" />
            <Stat label="NOON files not used" value={summary.noonFilesNotUsed} tone="text-slate-300" />
            <Stat label="Identical duplicates removed" value={summary.duplicatesDeduplicated} tone="text-slate-300" />
            <Stat label="Unsupported" value={summary.unsupportedFiles + summary.unsupportedPositions} tone="text-amber-300" />
            <Stat label="Broken URLs" value={summary.brokenUrls} tone="text-rose-300" />
            <Stat label="Delivery failures" value={summary.deliveryFailures} tone="text-rose-300" />
            <Stat label="Excel conflicts" value={images.summary ? countConflicts(images) : 0} tone="text-amber-300" />
          </div>

          {images.sourceTruncated ? (
            <p className="mt-3 text-xs text-amber-300">
              The batch has more files than one request processes; narrow the batch folder to review the rest.
            </p>
          ) : null}
          {images.urlChecksSkipped > 0 ? (
            <p className="mt-3 text-xs text-slate-400">
              {images.urlChecksSkipped} public URL checks were skipped to keep this request bounded. The URLs are still
              written; re-run to verify the remainder.
            </p>
          ) : null}

          <p className="mt-4 rounded-2xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-xs leading-relaxed text-sky-100">
            {images.retentionNote}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by SKU or product"
              aria-label="Filter images by SKU or product"
              className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
            {IMAGE_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  filter === option.id ? 'bg-amber-500 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-4">
            {groups.map((group) => (
              <article
                key={group.sku}
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
                data-testid="image-sku-group"
              >
                <header className="flex flex-wrap items-center gap-3">
                  <h3 className="text-sm font-bold text-white">{group.sku}</h3>
                  {group.productName ? <span className="text-xs text-slate-400">{group.productName}</span> : null}
                  {group.hasMainImage ? (
                    <Pill tone="bg-emerald-500/15 text-emerald-200 ring-emerald-400/30">main image ready</Pill>
                  ) : (
                    <Pill tone="bg-amber-500/15 text-amber-200 ring-amber-400/30">missing main image</Pill>
                  )}
                  <span className="text-[11px] text-slate-500">
                    {group.secondary.length} secondary
                    {group.problems.length ? ` · ${group.problems.length} need attention` : ''}
                  </span>
                </header>

                <div className="mt-3 flex flex-wrap gap-4">
                  {group.main ? <ImageTile record={group.main} /> : null}
                  {group.secondary.map((record) => (
                    <ImageTile key={record.sourceKey} record={record} />
                  ))}
                  {group.problems.map((record) => (
                    <ImageTile key={record.sourceKey} record={record} />
                  ))}
                </div>
              </article>
            ))}

            {!groups.length ? (
              <p className="rounded-2xl border border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-slate-400">
                No SKU matches this filter.
              </p>
            ) : null}

            {unassigned.length ? (
              <article className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-4">
                <h3 className="text-sm font-bold text-white">Files not mapped to a workbook SKU</h3>
                <p className="mt-1 text-xs text-slate-400">
                  These files were left out of the workbook entirely rather than guessed into a position.
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  {unassigned.map((record) => (
                    <li key={record.sourceKey} className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                      <Pill tone={statusTone(record.status)}>{record.status}</Pill>
                      <span className="break-all font-semibold text-slate-200">{record.filename}</span>
                      {record.warning ? <span className="text-amber-300">{record.warning}</span> : null}
                    </li>
                  ))}
                </ul>
              </article>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}

function countConflicts(images: ImagePreview): number {
  let count = 0
  for (const group of images.skus) {
    for (const record of [group.main, ...group.secondary, ...group.problems]) {
      if (record && record.populationStatus === 'existing-value-preserved') count += 1
    }
  }
  return count
}
