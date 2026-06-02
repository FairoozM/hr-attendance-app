import { useEffect, useState } from 'react'
import type { ClearanceResultRow, ManualMapping } from '../../../api/amazonOutOfStockClearance'

interface ManualEditModalProps {
  row: ClearanceResultRow | null
  onClose: () => void
  onSave: (amazonSku: string, mapping: ManualMapping) => void
}

export function ManualEditModal({ row, onClose, onSave }: ManualEditModalProps) {
  const [zohoSku, setZohoSku] = useState('')
  const [vigilCode, setVigilCode] = useState('')
  const [recommendedQty, setRecommendedQty] = useState('')

  useEffect(() => {
    if (!row) return
    setZohoSku(row.zohoSku || '')
    setVigilCode(row.vigilMatchedCode || '')
    setRecommendedQty(String(row.recommendedAmazonUpdateQty ?? 0))
  }, [row])

  if (!row) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-white">Manual review — {row.amazonSku}</h3>
        <p className="mt-1 text-sm text-slate-400">{row.amazonTitle}</p>
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-slate-400">
            Zoho SKU
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              value={zohoSku}
              onChange={(e) => setZohoSku(e.target.value)}
            />
          </label>
          <label className="block text-sm text-slate-400">
            Vigil item code
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              value={vigilCode}
              onChange={(e) => setVigilCode(e.target.value)}
            />
          </label>
          <label className="block text-sm text-slate-400">
            Recommended Amazon update qty
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              value={recommendedQty}
              onChange={(e) => setRecommendedQty(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-300"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
            onClick={() => {
              onSave(row.amazonSku, {
                locked: true,
                zohoSku: zohoSku.trim(),
                vigilCode: vigilCode.trim(),
                recommendedQty: Math.max(0, Math.floor(Number(recommendedQty) || 0)),
              })
              onClose()
            }}
          >
            Save manual override
          </button>
        </div>
      </div>
    </div>
  )
}
