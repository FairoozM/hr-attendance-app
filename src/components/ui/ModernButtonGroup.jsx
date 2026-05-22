/**
 * ModernButtonGroup — compact segmented control for small option sets.
 *
 * Works as single-select (radio) or multi-select (checkbox group).
 * Works with string[], number[], or object[] options.
 *
 * Props:
 *   label        string   optional label above the group
 *   value        any | any[]   current value(s)
 *   options      any[]    list of options
 *   onChange     fn       called with new value or new array (multi mode)
 *   multiple     bool     multi-select mode
 *   getLabel     fn(opt)  → string
 *   getValue     fn(opt)  → string | number
 *   getShortLabel fn(opt) → string   shorter label shown on narrow screens
 *   className    string
 */

import './ModernButtonGroup.css'

function toSafeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    if (typeof value.label === 'string') return value.label
    if (typeof value.name === 'string') return value.name
    if (typeof value.short === 'string') return value.short
    if (value.value !== undefined) return String(value.value)
    if (value.id !== undefined) return String(value.id)
  }
  return fallback
}

export function ModernButtonGroup({
  label,
  value,
  options = [],
  onChange,
  multiple = false,
  getLabel,
  getValue,
  getShortLabel,
  className = '',
}) {
  function getOptionValue(opt) {
    if (getValue) return getValue(opt)
    if (opt !== null && typeof opt === 'object') {
      if ('value' in opt) return opt.value
      if ('id' in opt) return opt.id
    }
    return opt
  }

  function getOptionLabel(opt, short = false) {
    if (short && getShortLabel) return toSafeString(getShortLabel(opt))
    if (getLabel) return toSafeString(getLabel(opt))
    if (opt !== null && typeof opt === 'object') {
      return (
        toSafeString(opt.label) ||
        toSafeString(opt.name) ||
        toSafeString(opt.short) ||
        toSafeString(opt.value) ||
        toSafeString(opt.id)
      )
    }
    return toSafeString(opt)
  }

  function isSelected(opt) {
    const v = getOptionValue(opt)
    if (multiple && Array.isArray(value)) {
      return value.map(String).includes(String(v))
    }
    return value !== undefined && value !== null && String(v) === String(value)
  }

  function handleClick(opt) {
    const v = getOptionValue(opt)
    if (multiple && Array.isArray(value)) {
      const strV = String(v)
      if (value.map(String).includes(strV)) {
        onChange(value.filter((x) => String(x) !== strV))
      } else {
        onChange([...value, v])
      }
    } else {
      onChange(v)
    }
  }

  return (
    <div className={`mbg-wrap${className ? ` ${className}` : ''}`}>
      {label && <span className="mbg-label">{label}</span>}
      <div
        className="mbg-group"
        role={multiple ? 'group' : 'radiogroup'}
        aria-label={label}
      >
        {options.map((opt) => {
          const v = getOptionValue(opt)
          const selected = isSelected(opt)
          const fullLabel = getOptionLabel(opt, false)
          const shortLabel = getShortLabel ? getOptionLabel(opt, true) : null
          return (
            <button
              key={String(v)}
              type="button"
              role={multiple ? undefined : 'radio'}
              aria-pressed={multiple ? selected : undefined}
              aria-checked={!multiple ? selected : undefined}
              className={`mbg-btn${selected ? ' mbg-btn--selected' : ''}`}
              onClick={() => handleClick(opt)}
            >
              {shortLabel ? (
                <>
                  <span className="mbg-btn__full">{fullLabel}</span>
                  <span className="mbg-btn__short">{shortLabel}</span>
                </>
              ) : (
                fullLabel
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
