import { getSubscriptionIconUrl } from '../../../lib/subscriptionIconMap'

const ICON_SIZE = 20
const CONTAINER_SIZE = 28

interface SubscriptionIconProps {
  name: string
  vendor?: string
  size?: number
  className?: string
  /** Larger drawer header icon */
  variant?: 'table' | 'drawer'
}

export function SubscriptionIcon({
  name,
  vendor,
  size = ICON_SIZE,
  className = '',
  variant = 'table',
}: SubscriptionIconProps) {
  const src = getSubscriptionIconUrl(name, vendor)
  const containerSize = variant === 'drawer' ? 40 : CONTAINER_SIZE
  const iconSize = variant === 'drawer' ? 24 : size

  return (
    <span
      className={`sub-icon-wrap ${variant === 'drawer' ? 'sub-icon-wrap--drawer' : ''} ${className}`.trim()}
      style={{ width: containerSize, height: containerSize }}
    >
      <img
        src={src}
        alt=""
        aria-hidden
        className="sub-icon-wrap__img"
        width={iconSize}
        height={iconSize}
        loading="lazy"
        decoding="async"
      />
    </span>
  )
}

interface SubscriptionNameWithIconProps extends SubscriptionIconProps {
  showName?: boolean
}

export function SubscriptionNameWithIcon({
  name,
  vendor,
  variant = 'table',
  className = '',
  showName = true,
}: SubscriptionNameWithIconProps) {
  return (
    <span className={`sub-name-with-icon ${className}`.trim()}>
      <SubscriptionIcon name={name} vendor={vendor} variant={variant} />
      {showName && <span className="sub-name-with-icon__label">{name}</span>}
    </span>
  )
}
