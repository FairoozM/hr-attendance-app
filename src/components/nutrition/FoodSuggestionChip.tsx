import { FoodImage } from './FoodImage'

type Props = {
  name: string
  imageUrl?: string | null
  whyNotes?: string | null
  onClick?: () => void
}

export function FoodSuggestionChip({ name, imageUrl, whyNotes, onClick }: Props) {
  return (
    <button type="button" className="nutrition-food-chip" onClick={onClick} title={whyNotes || undefined}>
      <FoodImage name={name} imageUrl={imageUrl} size="sm" />
      <span>{name}</span>
    </button>
  )
}
