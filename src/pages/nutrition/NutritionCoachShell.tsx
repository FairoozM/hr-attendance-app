import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useNutritionProfile } from '../../hooks/useNutritionCoach'
import '../Page.css'
import './NutritionCoach.css'

export const WELLNESS_DISCLAIMER =
  'For wellness tracking only. Not medical advice. Consult a doctor/dietitian if you have medical conditions, kidney issues, heart issues, diabetes, pregnancy, eating disorder history, or take medication.'

const NAV = [
  { to: '/health-fitness/dashboard', label: 'Nutrition Dashboard' },
  { to: '/health-fitness/food-log', label: 'Food Log' },
  { to: '/health-fitness/nutrient-gaps', label: 'Nutrient Gap Analysis' },
  { to: '/health-fitness/meal-plan', label: 'Meal Plan Builder' },
  { to: '/health-fitness/fitness-plan', label: 'Fitness Plan' },
  { to: '/health-fitness/progress', label: 'Progress Tracker' },
  { to: '/health-fitness/food-library', label: 'Food Library' },
  { to: '/health-fitness/calculators', label: 'Health Calculators' },
  { to: '/health-fitness/settings', label: 'Settings' },
]

export function WellnessDisclaimer() {
  return <div className="nutrition-disclaimer">{WELLNESS_DISCLAIMER}</div>
}

export function NutritionCoachShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, loading, onboardingCompleted } = useNutritionProfile()
  const onOnboarding = location.pathname.includes('/onboarding')
  const justFinished = !!(location.state as { onboardingCompleted?: boolean } | null)?.onboardingCompleted

  useEffect(() => {
    if (loading) return
    if (onOnboarding && (onboardingCompleted || justFinished)) {
      navigate('/health-fitness/dashboard', { replace: true })
      return
    }
    if (!onOnboarding && !onboardingCompleted && !justFinished) {
      navigate('/health-fitness/onboarding', { replace: true })
    }
  }, [loading, onboardingCompleted, onOnboarding, justFinished, navigate])

  if (loading && !onOnboarding) {
    return <div className="page nutrition-coach"><p>Loading your coach…</p></div>
  }

  if (onOnboarding) {
    return <Outlet />
  }

  return (
    <div className="page nutrition-coach">
      <header className="page-header">
        <h1 className="page-title">
          {profile?.display_name ? `${profile.display_name}'s Coach` : 'Nutrition & Fitness Coach'}
        </h1>
        <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', fontSize: '0.92rem' }}>
          Personal food, supplement, and training tracker with evidence-based wellness guidance.
        </p>
      </header>
      <WellnessDisclaimer />
      <nav className="nutrition-subnav" aria-label="Health & Fitness">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? 'active' : undefined)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="page-content">
        <Outlet />
      </div>
    </div>
  )
}

export function statusClass(status?: string) {
  if (status === 'okay') return 'nutrition-status--okay'
  if (status === 'low') return 'nutrition-status--low'
  if (status === 'high' || status === 'needs_attention') return 'nutrition-status--high'
  return ''
}
