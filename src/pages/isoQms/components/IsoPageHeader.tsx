import type { ReactNode } from 'react'

interface IsoPageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

export function IsoPageHeader({ title, subtitle, actions }: IsoPageHeaderProps) {
  return (
    <div className="iso-page-hero">
      <div>
        <h1 className="iso-page-title">{title}</h1>
        {subtitle ? <p className="iso-page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="iso-page-hero__actions">{actions}</div> : null}
    </div>
  )
}
