import { useEffect, useRef, useState } from 'react'

export interface IsoActionMenuItem {
  key: string
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

interface IsoActionMenuProps {
  items: IsoActionMenuItem[]
  label?: string
}

export function IsoActionMenu({ items, label = '⋮' }: IsoActionMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!items.length) return null

  return (
    <div className="iso-action-menu" ref={rootRef}>
      <button
        type="button"
        className="iso-action-menu__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <div className="iso-action-menu__panel" role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`iso-action-menu__item ${item.danger ? 'iso-action-menu__item--danger' : ''}`.trim()}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
