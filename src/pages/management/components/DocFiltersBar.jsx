import { STATUS } from '../utils/docExpiryUtils'
import { DOCUMENT_TYPES, COMPANIES } from '../data/seedDocuments'
import { ModernSearchInput } from '../../../components/ui/ModernSearchInput'
import { ModernSelect } from '../../../components/ui/ModernSelect'

const QUICK_FILTERS = [
  { id: 'all',      label: 'All'      },
  { id: 'vat',      label: 'VAT Only' },
  { id: 'expired',  label: 'Expired'  },
  { id: 'due-soon', label: 'Due Soon' },
  { id: 'urgent',   label: 'Urgent'   },
]

export function DocFiltersBar({ filters, onChange, onQuickFilter, activeQuick }) {
  const set = (key) => (val) => onChange({ ...filters, [key]: val })

  const clearAll = () =>
    onChange({ search: '', docType: '', company: '', status: '' })

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
        <ModernSearchInput
          placeholder="Search by name, type, company..."
          value={filters.search}
          onChange={set('search')}
        />
        <ModernSelect
          value={filters.docType}
          placeholder="Type: All"
          options={[
            { value: '', label: 'Type: All' },
            ...DOCUMENT_TYPES.map(t => ({ value: t, label: t })),
          ]}
          onChange={set('docType')}
        />
        <ModernSelect
          value={filters.company}
          placeholder="Company: All"
          options={[
            { value: '', label: 'Company: All' },
            ...COMPANIES.map(c => ({ value: c, label: c })),
          ]}
          onChange={set('company')}
        />
        <ModernSelect
          value={filters.status}
          placeholder="Status: All"
          options={[
            { value: '', label: 'Status: All' },
            ...Object.values(STATUS).map(s => ({ value: s, label: s })),
          ]}
          onChange={set('status')}
        />
        <button type="button" className="btn btn--ghost btn--sm" onClick={clearAll}>
          Clear
        </button>
      </div>
    </div>
  )
}
