import {
  computeEcommercePriceRow,
  fmtMoney,
  fmtPct,
  profitMarginDisplayClass,
} from './allPricesEcommerceUtils'

export interface AllPricesRates {
  vatPct: number | string
  commissionPct: number | string
  advertisingPct: number | string
  requiredProfitPct?: number | string
}

export interface FormulaPreviewRow {
  id: string
  itemNo: string
  salesPrice: string | number
  purchasePrice: string | number
  shipping: string | number
  dateOfPrices?: string
}

interface AllPricesFormulaViewProps {
  rates: AllPricesRates
  rows: FormulaPreviewRow[]
  sourceListName: string | null
  rowCount: number
  sumTakePct: number
  ratesInvalid: boolean
  onRatesChange: (patch: Partial<AllPricesRates>) => void
  onResetRates: () => void
  onRefreshSnapshot: () => void
}

function fmtShippingPurchaseDisplay(raw: string | number | null | undefined): string {
  if (raw === '' || raw == null) return '—'
  const n = Number(raw)
  if (!Number.isFinite(n)) return '—'
  return fmtMoney(n, 2)
}

export function AllPricesFormulaView({
  rates,
  rows,
  sourceListName,
  rowCount,
  sumTakePct,
  ratesInvalid,
  onRatesChange,
  onResetRates,
  onRefreshSnapshot,
}: AllPricesFormulaViewProps) {
  return (
    <section className="page-section ap-ec-wrap ap-formula-panel" aria-label="Price formula change">
      <div className="ap-ec-formula-note ap-formula-panel__banner" role="note">
        <strong>Preview only.</strong> This view loads a snapshot from{' '}
        <strong>{sourceListName || 'your Price list'}</strong> ({rowCount.toLocaleString()} rows). Adjust VAT,
        commission, and advertising here to explore margins — the <strong>Price list</strong> tab is not changed.
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
          <button type="button" className="btn btn--ghost" style={{ marginLeft: '0.5rem' }} onClick={onRefreshSnapshot}>
            Refresh snapshot from Price list
          </button>
        </div>
      </div>

      {ratesInvalid ? (
        <p className="ap-ec-error" role="alert">
          VAT, commission, and advertising add up to 100% or more. Lower them so fee amounts can be calculated.
        </p>
      ) : (
        <p className="ap-formula-panel__hint">
          Profit % uses wholesales sales price as-is. Red below 25%, green above 26%.
        </p>
      )}

      <div className="ap-table-scroll">
        <table className="ap-ec-table">
          <thead>
            <tr>
              <th scope="col" className="ap-ec-row-number">
                Sr no.
              </th>
              <th scope="col">Item no.</th>
              <th scope="col" className="col-accent">
                Sales price (AED)
              </th>
              <th scope="col">{rates.vatPct}% VAT</th>
              <th scope="col">{rates.commissionPct}% commission</th>
              <th scope="col">{rates.advertisingPct}% advertising</th>
              <th scope="col">Shipping</th>
              <th scope="col" className="col-purchase">
                Purchase price
              </th>
              <th scope="col" className="col-cost-sum">
                Purchase + VAT + comm. + adv. + shipping
              </th>
              <th scope="col">Sales − costs (profit)</th>
              <th scope="col" className="col-accent">
                Profit % of sales
              </th>
              <th scope="col">Date of prices</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="ap-ec-empty">
                  No snapshot loaded. Save a price list on the Price list tab, then open this view again.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const computed = computeEcommercePriceRow(row, rates)
                const salesNum = Number(row.salesPrice)
                const purchaseNum = Number(row.purchasePrice)
                const shipNum = Number(row.shipping)
                const hasInputs =
                  row.salesPrice !== '' &&
                  row.purchasePrice !== '' &&
                  row.shipping !== '' &&
                  Number.isFinite(salesNum) &&
                  Number.isFinite(purchaseNum) &&
                  Number.isFinite(shipNum)

                return (
                  <tr key={row.id}>
                    <td className="ap-ec-row-number">{index + 1}</td>
                    <td className="ainv-table__sku">{row.itemNo || '—'}</td>
                    <td className="col-accent">
                      <span className="ap-ec-num ap-ec-cell-readonly">
                        {hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.salesPrice, 0) : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="ap-ec-num">
                        {hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.vatAmount) : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="ap-ec-num">
                        {hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.commissionAmount) : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="ap-ec-num">
                        {hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.advertisingAmount) : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="ap-ec-num ap-ec-cell-readonly">
                        {fmtShippingPurchaseDisplay(row.shipping)}
                      </span>
                    </td>
                    <td className="col-purchase">
                      <span className="ap-ec-num ap-ec-cell-readonly">
                        {fmtShippingPurchaseDisplay(row.purchasePrice)}
                      </span>
                    </td>
                    <td className="col-cost-sum">
                      <span className="ap-ec-num">
                        {hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.totalCost) : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="ap-ec-num">
                        {hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.profit) : '—'}
                      </span>
                    </td>
                    <td className="col-accent">
                      <span
                        className={`ap-ec-num ${
                          hasInputs && !computed.denominatorInvalid
                            ? profitMarginDisplayClass(computed.profitPct)
                            : ''
                        }`}
                      >
                        {hasInputs && !computed.denominatorInvalid ? fmtPct(computed.profitPct) : '—'}
                      </span>
                    </td>
                    <td className="ap-ec-num--muted">{row.dateOfPrices || '—'}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
