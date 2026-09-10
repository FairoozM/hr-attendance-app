import type { ReactNode } from 'react'

export interface IsoFilterField {
  key: string
  label?: string
  type?: 'text' | 'select' | 'date'
  placeholder?: string
  options?: { value: string; label: string }[]
}

interface IsoFiltersBarProps<T extends Record<string, string>> {
  fields: IsoFilterField[]
  values: T
  onChange: (next: T) => void
  trailing?: ReactNode
}

export function IsoFiltersBar<T extends Record<string, string>>({
  fields,
  values,
  onChange,
  trailing,
}: IsoFiltersBarProps<T>) {
  return (
    <div className="iso-filters">
      <div className="iso-filters__fields">
        {fields.map((field) => {
          if (field.type === 'select') {
            return (
              <select
                key={field.key}
                className="iso-filters__select"
                aria-label={field.label || field.key}
                value={values[field.key] || ''}
                onChange={(e) => onChange({ ...values, [field.key]: e.target.value } as T)}
              >
                <option value="">{field.placeholder || field.label || 'All'}</option>
                {(field.options || []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )
          }
          return (
            <input
              key={field.key}
              className="iso-filters__input"
              type={field.type === 'date' ? 'date' : 'search'}
              aria-label={field.label || field.key}
              placeholder={field.placeholder || field.label || ''}
              value={values[field.key] || ''}
              onChange={(e) => onChange({ ...values, [field.key]: e.target.value } as T)}
            />
          )
        })}
        {trailing}
      </div>
    </div>
  )
}
