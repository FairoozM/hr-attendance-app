import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { aiAxios } from '../api/axiosAi'
import { AmazonListingPreview } from '../components/ai/AmazonListingPreview'

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function AmazonListingGenerator() {
  const [listing, setListing] = useState(null)
  const [savedMeta, setSavedMeta] = useState(null)
  const [busy, setBusy] = useState(false)
  const [apiError, setApiError] = useState('')

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      sku: '',
      product_name: '',
      brand: 'LIFE SMILE',
      material: '',
      color: '',
      size: '',
      dimensions: '',
      marketplace: 'UAE',
      language: 'EN',
      is_cookware_set: false,
      features: [{ value: 'Non-stick coating' }, { value: '' }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'features' })

  const marketplace = watch('marketplace')
  const language = watch('language')

  const onGenerate = handleSubmit(async (values) => {
    setBusy(true)
    setApiError('')
    setSavedMeta(null)
    try {
      const features = (values.features || []).map((f) => String(f.value || '').trim()).filter(Boolean)
      const body = {
        sku: values.sku.trim(),
        product_name: values.product_name.trim(),
        brand: values.brand.trim() || 'LIFE SMILE',
        material: values.material.trim(),
        color: values.color.trim(),
        size: values.size.trim(),
        dimensions: values.dimensions.trim(),
        marketplace,
        language,
        features,
        is_cookware_set: Boolean(values.is_cookware_set),
      }
      const { data } = await aiAxios.post('/api/amazon/generate-listing', body)
      if (!data.success) {
        throw new Error(data.message || 'Generation failed')
      }
      setListing({
        title: data.title,
        bullet_points: data.bullet_points,
        description: data.description,
        search_terms: data.search_terms,
        arabic_title: data.arabic_title,
        arabic_bullets: data.arabic_bullets,
        suggested_attributes: data.suggested_attributes || {},
      })
      setSavedMeta({
        id: data.id,
        created_at: data.created_at,
        meta: data.meta,
      })
    } catch (e) {
      const msg =
        e.response?.data?.message ||
        e.response?.data?.error ||
        e.message ||
        'Request failed'
      setApiError(msg)
    } finally {
      setBusy(false)
    }
  })

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-8 px-4 pb-16 pt-4 md:px-6">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-600/10 via-transparent to-violet-600/10 p-6 backdrop-blur-xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300/90">Amazon UAE / KSA</p>
        <h1 className="mt-1 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
          LIFE SMILE listing generator
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Structured product input → OpenAI on the server → SEO-focused listing with bilingual preview. Cookware sets can
          enforce “Cookware Set / Cooking Set / Pots and Pans Set” phrasing when flagged.
        </p>
      </header>

      {apiError ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{apiError}</div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <form
          onSubmit={onGenerate}
          className="space-y-5 rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md"
        >
          <h2 className="text-lg font-bold text-white">Product input</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-400">
              SKU *
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                {...register('sku', { required: 'SKU required' })}
              />
              {errors.sku ? <span className="text-xs text-rose-400">{errors.sku.message}</span> : null}
            </label>
            <label className="block text-xs font-semibold text-slate-400">
              Product name *
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                {...register('product_name', { required: 'Name required' })}
              />
              {errors.product_name ? <span className="text-xs text-rose-400">{errors.product_name.message}</span> : null}
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-400">
              Brand
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                {...register('brand')}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-400">
              Material
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                {...register('material')}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-400">
              Color
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                {...register('color')}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-400">
              Size / capacity
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                {...register('size')}
              />
            </label>
          </div>

          <label className="block text-xs font-semibold text-slate-400">
            Dimensions
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
              {...register('dimensions')}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-400">
              Marketplace
              <select
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                {...register('marketplace')}
              >
                <option value="UAE">Amazon UAE (AE)</option>
                <option value="KSA">Amazon KSA (SA)</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-400">
              Primary language mode
              <select
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                {...register('language')}
              >
                <option value="EN">English-forward</option>
                <option value="AR">Arabic-forward</option>
              </select>
            </label>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="rounded border-white/20 bg-black/40" {...register('is_cookware_set')} />
            Cookware / pot set (enforce Life Smile multi-phrase title rules)
          </label>

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-400">Features</p>
              <button
                type="button"
                onClick={() => append({ value: '' })}
                className="text-xs font-semibold text-violet-300 hover:text-violet-200"
              >
                + Add feature
              </button>
            </div>
            <ul className="mt-2 space-y-2">
              {fields.map((field, index) => (
                <li key={field.id} className="flex gap-2">
                  <input
                    className="flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-violet-500/40"
                    placeholder="Feature / benefit"
                    {...register(`features.${index}.value`)}
                  />
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="rounded-xl px-3 text-xs text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/10"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-900/30 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
            >
              {busy ? 'Generating…' : 'Generate with AI'}
            </button>
          </div>
        </form>

        <div className="space-y-4">
          {savedMeta ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              Saved to PostgreSQL as listing #{savedMeta.id}. Model {savedMeta.meta?.model}, ≈
              {Number(savedMeta.meta?.estimated_cost_usd || 0).toFixed(6)} USD, {savedMeta.meta?.duration_ms ?? '—'} ms.
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-slate-500">
              Generate to create a stored row in <code className="text-slate-400">amazon_generated_listings</code> with full
              audit metadata.
            </div>
          )}

          {listing ? (
            <>
              <AmazonListingPreview listing={listing} onChange={setListing} />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    downloadJson(`life-smile-${savedMeta?.id || 'listing'}.json`, {
                      ...listing,
                      saved_id: savedMeta?.id,
                      marketplace,
                      language,
                    })
                  }
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  Export JSON
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center text-sm text-slate-500">
              Preview appears here after generation. All fields remain editable before export.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
