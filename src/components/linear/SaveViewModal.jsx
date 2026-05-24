/**
 * SaveViewModal.jsx
 * Minimal modal for naming and saving the current filter state as a view.
 */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Bookmark } from 'lucide-react'
import './SaveViewModal.css'

export function SaveViewModal({ open, onClose, onSave }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setName(''); setError('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function handleSave(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Please enter a name for the view.'); return }
    onSave(trimmed)
    onClose()
  }

  if (!open) return null

  return createPortal(
    <div
      className="svm-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="svm-panel" role="dialog" aria-modal="true" aria-label="Save View">
        <div className="svm-header">
          <span className="svm-header__title">
            <Bookmark size={13} strokeWidth={2} aria-hidden="true" />
            Save View
          </span>
          <button type="button" className="svm-close" onClick={onClose} aria-label="Close">
            <X size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>

        <form className="svm-form" onSubmit={handleSave} noValidate>
          <input
            ref={inputRef}
            type="text"
            className="svm-input"
            placeholder="View name…"
            value={name}
            onChange={(e) => { setName(e.target.value); setError('') }}
            maxLength={60}
            aria-label="View name"
          />
          {error && <p className="svm-error" role="alert">{error}</p>}
          <div className="svm-actions">
            <button type="button" className="svm-btn svm-btn--cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="svm-btn svm-btn--save" disabled={!name.trim()}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

export default SaveViewModal
