import { useEffect, useState } from 'react'

export function AmazonListingPreview({ listing, onChange }) {
  const [attrRaw, setAttrRaw] = useState('{}')

  const attrSig = JSON.stringify(listing?.suggested_attributes || {})
  useEffect(() => {
    setAttrRaw(JSON.stringify(listing?.suggested_attributes || {}, null, 2))
  }, [attrSig])

  if (!listing) return null

  const setField = (key, val) => {
    if (onChange) onChange({ ...listing, [key]: val })
  }

  const setBullet = (idx, val) => {
    const bullet_points = [...(listing.bullet_points || [])]
    bullet_points[idx] = val
    setField('bullet_points', bullet_points)
  }

  const setArabicBullet = (idx, val) => {
    const arabic_bullets = [...(listing.arabic_bullets || [])]
    arabic_bullets[idx] = val
    setField('arabic_bullets', arabic_bullets)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="text-sm font-bold uppercase tracking-widest text-violet-300">English</h3>
        <label className="block text-xs font-semibold text-slate-400">
          Title
          <input
            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
            value={listing.title || ''}
            onChange={(e) => setField('title', e.target.value)}
          />
        </label>
        <div>
          <p className="text-xs font-semibold text-slate-400">Bullet points</p>
          <ul className="mt-2 space-y-2">
            {(listing.bullet_points || []).map((b, i) => (
              <li key={i}>
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                  value={b}
                  onChange={(e) => setBullet(i, e.target.value)}
                />
              </li>
            ))}
          </ul>
        </div>
        <label className="block text-xs font-semibold text-slate-400">
          Description
          <textarea
            rows={6}
            className="mt-1 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
            value={listing.description || ''}
            onChange={(e) => setField('description', e.target.value)}
          />
        </label>
        <label className="block text-xs font-semibold text-slate-400">
          Search terms (one per line)
          <textarea
            rows={4}
            className="mt-1 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-white outline-none focus:ring-2 focus:ring-violet-500/40"
            value={(listing.search_terms || []).join('\n')}
            onChange={(e) =>
              setField(
                'search_terms',
                e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
          />
        </label>
      </div>

      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="text-sm font-bold uppercase tracking-widest text-cyan-300">Arabic</h3>
        <label className="block text-xs font-semibold text-slate-400">
          Arabic title
          <input
            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-500/40"
            dir="rtl"
            value={listing.arabic_title || ''}
            onChange={(e) => setField('arabic_title', e.target.value)}
          />
        </label>
        <div>
          <p className="text-xs font-semibold text-slate-400">Arabic bullets</p>
          <ul className="mt-2 space-y-2">
            {(listing.arabic_bullets || []).map((b, i) => (
              <li key={i}>
                <input
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-500/40"
                  dir="rtl"
                  value={b}
                  onChange={(e) => setArabicBullet(i, e.target.value)}
                />
              </li>
            ))}
          </ul>
        </div>
        <label className="block text-xs font-semibold text-slate-400">
          Suggested attributes (JSON)
          <textarea
            rows={5}
            spellCheck={false}
            className="mt-1 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-white outline-none focus:ring-2 focus:ring-violet-500/40"
            value={attrRaw}
            onChange={(e) => setAttrRaw(e.target.value)}
            onBlur={() => {
              try {
                const parsed = JSON.parse(attrRaw || '{}')
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                  setField('suggested_attributes', parsed)
                }
              } catch {
                setAttrRaw(JSON.stringify(listing.suggested_attributes || {}, null, 2))
              }
            }}
          />
        </label>
      </div>
    </div>
  )
}
