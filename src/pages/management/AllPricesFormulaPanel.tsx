import { fmtMoney } from './allPricesEcommerceUtils'

export interface AllPricesRates {
  vatPct: number | string
  commissionPct: number | string
  advertisingPct: number | string
  requiredProfitPct?: number | string
}

interface AllPricesFormulaPanelProps {
  rates: AllPricesRates
  sumTakePct: number
  ratesInvalid: boolean
  onRatesChange: (patch: Partial<AllPricesRates>) => void
  onResetRates: () => void
}

export function AllPricesFormulaPanel({
  rates,
  sumTakePct,
  ratesInvalid,
  onRatesChange,
  onResetRates,
}: AllPricesFormulaPanelProps) {
  return (
    <section className="page-section ap-ec-wrap ap-formula-panel" aria-label="Price formula change">
      <div className="ap-ec-formula-note" role="note">
        <strong>Sales price comes from the wholesales department</strong> — paste it as-is from their sheet on
        the Price list tab. VAT, commission, and advertising are calculated from that sales price. Profit % is
        shown for review only (management may target 15%–35% or other margins).
      </div>

      <div className="ap-ec-rates">
        <label>
          VAT %
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={rates.vatPct}
            onChange={(e) => onRatesChange({ vatPct: e.target.value })}
          />
        </label>
        <label>
          Commission %
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={rates.commissionPct}
            onChange={(e) => onRatesChange({ commissionPct: e.target.value })}
          />
        </label>
        <label>
          Advertising %
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={rates.advertisingPct}
            onChange={(e) => onRatesChange({ advertisingPct: e.target.value })}
          />
        </label>
        <div className="ap-ec-rates__meta">
          Fee take from sales: <strong>{fmtMoney(sumTakePct, 2)}%</strong> (VAT + commission + advertising)
          <button type="button" className="btn btn--ghost" style={{ marginLeft: '0.75rem' }} onClick={onResetRates}>
            Reset rates to 5 / 15 / 15
          </button>
        </div>
      </div>

      {ratesInvalid ? (
        <p className="ap-ec-error" role="alert">
          VAT, commission, and advertising add up to 100% or more. Lower them so fee amounts can be calculated.
        </p>
      ) : (
        <p className="ap-formula-panel__hint">
          Changes here apply to the Price list immediately. Saved lists keep their own rate snapshot when you save
          or update a list.
        </p>
      )}
    </section>
  )
}
