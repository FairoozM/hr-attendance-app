import { getSubscriptionIconUrl } from '../../../lib/subscriptionIconMap'

interface SubscriptionIconProps {
  name: string
  vendor?: string
  /** Pixel size — table ~22, drawer header ~36 */
  size?: number
  className?: string
}

export function SubscriptionIcon({ name, vendor, size = 22, className = '' }: SubscriptionIconProps) {
  const src = getSubscriptionIconUrl(name, vendor)

  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className={`sub-icon ${className}`.trim()}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
    />
  )
}

interface SubscriptionNameWithIconProps extends SubscriptionIconProps {
  showName?: boolean
}

export function SubscriptionNameWithIcon({
  name,
  vendor,
  size = 22,
  className = '',
  showName = true,
}: SubscriptionNameWithIconProps) {
  return (
    <span className={`sub-name-with-icon ${className}`.trim()}>
      <SubscriptionIcon name={name} vendor={vendor} size={size} />
      {showName && <span className="sub-name-with-icon__label">{name}</span>}
    </span>
  )
}
