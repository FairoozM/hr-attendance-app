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
    <div className="ainv-modal-backdrop">
      <div className="ainv-modal w-full max-w-md">
        <h3 className="ainv-modal__title">Manual review — {row.amazonSku}</h3>
        <p className="ainv-modal__body">{row.amazonTitle}</p>
        <div className="mt-4 space-y-3">
          <label className="ainv-label">
            Zoho SKU
            <input className="ainv-input" value={zohoSku} onChange={(e) => setZohoSku(e.target.value)} />
          </label>
          <label className="ainv-label">
            Vigil item code
            <input className="ainv-input" value={vigilCode} onChange={(e) => setVigilCode(e.target.value)} />
          </label>
          <label className="ainv-label">
            Recommended Amazon update qty
            <input
              type="number"
              min={0}
              className="ainv-input"
              value={recommendedQty}
              onChange={(e) => setRecommendedQty(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="ainv-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ainv-btn ainv-btn--primary-emerald"
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
