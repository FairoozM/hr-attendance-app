import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type InfluencerModulePlaceholderProps = {
  title: string
  description: string
  children?: ReactNode
}

export function InfluencerModulePlaceholder({
  title,
  description,
  children,
}: InfluencerModulePlaceholderProps) {
  return (
    <section className="clay-card inf-module-placeholder">
      <h2 className="inf-module-placeholder__title">{title}</h2>
      <p className="inf-module-placeholder__desc">{description}</p>
      {children}
    </section>
  )
}

type LegacyLinkProps = {
  label: string
  to: string
}

export function InfluencerLegacyPageLink({ label, to }: LegacyLinkProps) {
  return (
    <Link to={to} style={{ fontWeight: 700, color: 'inherit' }}>
      {label}
    </Link>
  )
}
