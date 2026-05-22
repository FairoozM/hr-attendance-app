/**
 * ModernSearchInput — styled search field with icon + clear button.
 *
 * Props:
 *   label        string   optional label above input
 *   value        string   current value
 *   onChange     fn(str)  called with the new input value
 *   placeholder  string
 *   onClear      fn       optional custom clear handler (defaults to onChange(''))
 *   disabled     bool
 *   className    string
 *   id           string   for the <input> element
 */

import { useRef } from 'react'
import { Search, X } from 'lucide-react'
import './ModernSearchInput.css'

export function ModernSearchInput({
  label,
  value,
  onChange,
  placeholder = 'Search…',
  onClear,
  disabled = false,
  className = '',
  id,
}) {
  const inputRef = useRef(null)

  function handleClear() {
    if (onClear) onClear()
    else onChange('')
    inputRef.current?.focus()
  }

  return (
    <div className={`msi-wrap${className ? ` ${className}` : ''}`}>
      {label && <span className="msi-label">{label}</span>}
      <div className={`msi-field${disabled ? ' msi-field--disabled' : ''}`}>
        <span className="msi-icon" aria-hidden="true">
          <Search size={14} strokeWidth={2} />
        </span>
        <input
          ref={inputRef}
          id={id}
          type="search"
          className="msi-input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
        {value ? (
          <button
            type="button"
            className="msi-clear"
            onClick={handleClear}
            aria-label="Clear search"
            tabIndex={0}
          >
            <X size={11} strokeWidth={2.5} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
