import { useNavigate } from 'react-router-dom'
import * as api from '../../api/nutritionCoach'

type Props = {
  onRefresh?: () => void
  onWhatToEat?: () => void
  onFixToday?: () => void
}

export function QuickActionBar({ onRefresh, onWhatToEat, onFixToday }: Props) {
  const navigate = useNavigate()

  return (
    <div className="nutrition-quick-actions">
      <button type="button" className="nutrition-btn nutrition-btn--primary" onClick={onWhatToEat}>What should I eat next?</button>
      <button type="button" className="nutrition-btn" onClick={onFixToday}>Fix today&apos;s nutrition</button>
      <button type="button" className="nutrition-btn" onClick={() => navigate('/health-fitness/fitness-plan')}>Generate gym plan</button>
      <button type="button" className="nutrition-btn" onClick={() => navigate('/health-fitness/fitness-plan')}>Log workout</button>
      <button type="button" className="nutrition-btn" onClick={onRefresh}>Refresh dashboard</button>
      <button type="button" className="nutrition-btn" onClick={() => window.open(api.nutritionExportUrl('daily'), '_blank')}>Export today</button>
    </div>
  )
}
