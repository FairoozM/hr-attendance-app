import { useState, useMemo } from 'react'
import { imageUrlForFoodName } from '../../utils/foodImageMap'

type Props = {
  name?: string
  imageUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const PLACEHOLDER = '/food-placeholder.svg'

export function FoodImage({ name, imageUrl, size = 'md', className = '' }: Props) {
  const [failed, setFailed] = useState(false)
  const resolved = useMemo(
    () => imageUrl || (name ? imageUrlForFoodName(name) : null),
    [imageUrl, name],
  )
  const src = !failed && resolved ? resolved : PLACEHOLDER
  return (
    <img
      src={src}
      alt={name || 'Food'}
      className={`nutrition-food-img nutrition-food-img--${size} ${className}`.trim()}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}
