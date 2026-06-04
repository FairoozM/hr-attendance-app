import { Trash2 } from 'lucide-react'
import { Badge } from './PurchasePlanningBadges'

export function UnmatchedLowStockTable({ items, onRemove, removingId }) {
  if (!items?.length) return null

  return (
    <div className="pp-enrichment-list pp-enrichment-list--unmatched">
      <div className="pp-enrichment-list__head">
        <div>
          <strong>Blocked: {items.length} SKU(s) without Zoho item ID</strong>
          <span>Remove invalid rows (e.g. file headers) or fix SKUs in Zoho, then continue to Step 4.</span>
        </div>
      </div>
      <div className="doc-table-wrap pp-enrichment-list__table-wrap">
        <table className="doc-table pp-enrichment-list__table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id || item.sku}>
                <td className="pp-mono">{item.sku}</td>
                <td>
                  <Badge tone="danger">Missing Zoho item</Badge>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn--sm pp-remove-sku-btn"
                    disabled={!item.id || removingId === item.id}
                    title={`Remove ${item.sku} from this batch`}
                    onClick={() => onRemove(item)}
                  >
                    <Trash2 size={14} aria-hidden />
                    {removingId === item.id ? 'Removing…' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
