import { useCallback, useEffect, useMemo, useState } from 'react'
import '../Page.css'
import './DocumentExpiryPage.css'
import './AllPricesPage.css'
import {
  computeEcommercePriceRow,
  DEFAULT_RATES,
  fmtMoney,
  fmtPct,
  loadRates,
  loadRows,
  makeRowId,
  saveRates,
  saveRows,
  seedEcommerceRows,
} from './allPricesEcommerceUtils'

export function AllPricesPage() {
  const [rates, setRates] = useState(() => loadRates())
  const [rows, setRows] = useState(() => loadRows() || seedEcommerceRows())

  useEffect(() => {
    saveRates(rates)
  }, [rates])

  useEffect(() => {
    saveRows(rows)
  }, [rows])

  const sumTakePct = useMemo(() => {
    const v = Number(rates.vatPct) || 0
    const c = Number(rates.commissionPct) || 0
    const a = Number(rates.advertisingPct) || 0
    const p = Number(rates.requiredProfitPct) || 0
    return v + c + a + p
  }, [rates])

  const denominatorPct = useMemo(() => Math.max(0, 100 - sumTakePct), [sumTakePct])
  const ratesInvalid = sumTakePct >= 100

  const updateRow = useCallback((id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      {
        id: makeRowId(),
        itemNo: '',
        purchasePrice: '',
        shipping: '',
        dateOfPrices: '',
      },
    ])
  }, [])

  const deleteRow = useCallback((id) => {
    if (!window.confirm('Remove this row from the price list?')) return
    setRows((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const resetToSeed = useCallback(() => {
    if (!window.confirm('Replace all rows with the default BRKH-64 template? Your edits will be lost.')) return
    setRows(seedEcommerceRows())
  }, [])

  const resetRates = useCallback(() => {
    setRates({ ...DEFAULT_RATES })
  }, [])

  return (
    <div className="page ap-ec-page">
      <div className="doc-page-hero">
        <div>
          <h1 className="doc-page-title">All Prices (UAE &amp; KSA)</h1>
          <p className="doc-page-subtitle">
            Ecommerce selling price calculator (UAE · AED). Enter <strong>purchase price</strong> and{' '}
            <strong>shipping</strong>; sales price is derived so marketplace VAT, commission, advertising, and target
            profit are covered.
          </p>
        </div>
      </div>

      <section className="page-section ap-ec-wrap" aria-label="Ecommerce price list">
        <div className="ap-ec-formula-note" role="note">
          <strong>Required sales price</strong> when purchase + shipping are known:{' '}
          <code>
            (Purchase + Shipping) ÷ (1 − VAT − Commission − Advertising − Required profit)
          </code>
          <br />
          Default matches your sheet: 5% + 15% + 15% + 25% = 60% → divide by{' '}
          <strong>40%</strong>. Values shown use <strong>rounded</strong> AED sales price (e.g. 119.58 → 120); VAT,
          commission, and advertising are calculated on that rounded price.
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
              onChange={(e) => setRates((r) => ({ ...r, vatPct: e.target.value }))}
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
              onChange={(e) => setRates((r) => ({ ...r, commissionPct: e.target.value }))}
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
              onChange={(e) => setRates((r) => ({ ...r, advertisingPct: e.target.value }))}
            />
          </label>
          <label>
            Required profit %
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={rates.requiredProfitPct}
              onChange={(e) => setRates((r) => ({ ...r, requiredProfitPct: e.target.value }))}
            />
          </label>
          <div className="ap-ec-rates__meta">
            Combined take rate: <strong>{fmtMoney(sumTakePct, 2)}%</strong> · Effective divisor:{' '}
            <strong>{fmtMoney(denominatorPct, 2)}%</strong> of sales price remains after deductions (must be &gt; 0).
            <button type="button" className="btn btn--ghost" style={{ marginLeft: '0.75rem' }} onClick={resetRates}>
              Reset rates to 5 / 15 / 15 / 25
            </button>
          </div>
        </div>

        {ratesInvalid ? (
          <p className="ap-ec-error" role="alert">
            The four percentages add up to 100% or more. Lower them so the divisor (1 − sum) stays positive.
          </p>
        ) : null}

        <div className="ap-ec-toolbar">
          <button type="button" className="btn btn--primary" onClick={addRow}>
            + Add row
          </button>
          <button type="button" className="btn btn--ghost" onClick={resetToSeed}>
            Reset to BRKH-64 template
          </button>
        </div>

        <div className="ap-table-scroll">
          <table className="ap-ec-table">
            <thead>
              <tr>
                <th scope="col">Item no.</th>
                <th scope="col" className="col-accent" title="New website, Noon & Amazon sales price">
                  Sales price (AED)
                </th>
                <th scope="col">{rates.vatPct}% VAT</th>
                <th scope="col">{rates.commissionPct}% commission</th>
                <th scope="col">{rates.advertisingPct}% advertising</th>
                <th scope="col">Shipping</th>
                <th scope="col" className="col-purchase" title="Purchase price ecommerce">
                  Purchase price
                </th>
                <th scope="col">Purchase + VAT + comm. + adv. + shipping</th>
                <th scope="col">Sales − costs (profit)</th>
                <th scope="col" className="col-accent">
                  Profit % of sales
                </th>
                <th scope="col">Date of prices</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const computed = computeEcommercePriceRow(row, rates)
                const purchaseNum = Number(row.purchasePrice)
                const shipNum = Number(row.shipping)
                const hasInputs =
                  row.purchasePrice !== '' &&
                  row.shipping !== '' &&
                  Number.isFinite(purchaseNum) &&
                  Number.isFinite(shipNum)

                return (
                  <tr key={row.id}>
                    <td>
                      <input
                        className="item-no-input"
                        type="text"
                        value={row.itemNo}
                        onChange={(e) => updateRow(row.id, { itemNo: e.target.value })}
                        aria-label="Item number"
                      />
                    </td>
                    <td className="col-accent">
                      {!hasInputs || computed.denominatorInvalid ? (
                        <span className="ap-ec-num">—</span>
                      ) : (
                        <>
                          <span className="ap-ec-num">{computed.salesPrice}</span>
                          <div className="ap-ec-num--muted">raw {fmtMoney(computed.salesPriceRaw)}</div>
                        </>
                      )}
                    </td>
                    <td>
                      <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.vatAmount) : '—'}</span>
                    </td>
                    <td>
                      <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.commissionAmount) : '—'}</span>
                    </td>
                    <td>
                      <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.advertisingAmount) : '—'}</span>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.shipping}
                        onChange={(e) => updateRow(row.id, { shipping: e.target.value })}
                        aria-label="Shipping cost"
                      />
                    </td>
                    <td className="col-purchase">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.purchasePrice}
                        onChange={(e) => updateRow(row.id, { purchasePrice: e.target.value })}
                        aria-label="Purchase price ecommerce"
                      />
                    </td>
                    <td>
                      <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.totalCost) : '—'}</span>
                    </td>
                    <td>
                      <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtMoney(computed.profit) : '—'}</span>
                    </td>
                    <td className="col-accent">
                      <span className="ap-ec-num">{hasInputs && !computed.denominatorInvalid ? fmtPct(computed.profitPct) : '—'}</span>
                    </td>
                    <td>
                      <input
                        type="date"
                        value={row.dateOfPrices || ''}
                        onChange={(e) => updateRow(row.id, { dateOfPrices: e.target.value })}
                        aria-label="Date of prices"
                      />
                    </td>
                    <td className="ap-ec-actions">
                      <button type="button" className="ap-ec-del" onClick={() => deleteRow(row.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="doc-page-subtitle" style={{ marginTop: '1rem', marginBottom: 0 }}>
          Data is saved in this browser (localStorage). Add a KSA (SAR) sheet later by duplicating this block with
          different defaults if needed.
        </p>
      </section>
    </div>
  )
}
