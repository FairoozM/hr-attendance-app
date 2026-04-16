import { STATUS } from '../utils/docExpiryUtils'
import { DOCUMENT_TYPES, COMPANIES } from '../data/seedDocuments'

const QUICK_FILTERS = [
  { id: 'all',      label: 'All'      },
  { id: 'vat',      label: 'VAT Only' },
  { id: 'expired',  label: 'Expired'  },
  { id: 'due-soon', label: 'Due Soon' },
  { id: 'urgent',   label: 'Urgent'   },
]

export function DocFiltersBar({ filters, onChange, onQuickFilter, activeQuick }) {
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value })

  const clearAll = () =>
    onChange({ search: '', docType: '', company: '', status: '', responsible: '', _persons: filters._persons })

  return (
    <div className="doc-filters">
      <div className="doc-filters__quick">
        {QUICK_FILTERS.map(q => (
          <button
            key={q.id}
            type="button"
            className={`btn btn--ghost btn--sm${activeQuick === q.id ? ' doc-filters__quick-btn--active' : ''}`}
            onClick={() => onQuickFilter(q.id)}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="doc-filters__fields">
        <input
          type="search"
          placeholder="Search by name, type, company..."
          value={filters.search}
          onChange={set('search')}
          className="doc-filters__input"
        />
        <select value={filters.docType} onChange={set('docType')} className="doc-filters__select">
          <option value="">Type: All</option>
          {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filters.company} onChange={set('company')} className="doc-filters__select">
          <option value="">Company: All</option>
          {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.status} onChange={set('status')} className="doc-filters__select">
          <option value="">Status: All</option>
          {Object.values(STATUS).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.responsible} onChange={set('responsible')} className="doc-filters__select">
          <option value="">Person: All</option>
          {(filters._persons || []).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="button" className="btn btn--ghost btn--sm" onClick={clearAll}>
          Clear
        </button>
      </div>
    </div>
  )
}
