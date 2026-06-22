import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../../api/nutritionCoach'
import { WellnessDisclaimer } from './NutritionCoachShell'
import { ACTIVITY_LEVELS, GOALS, DIETARY_PREFERENCES } from '../../components/nutrition/nutritionConstants'
import '../Page.css'
import './NutritionCoach.css'

const STEPS = [
  { id: 'welcome', title: 'Welcome', subtitle: 'Let\'s personalize your wellness coach.' },
  { id: 'body', title: 'About you', subtitle: 'Basic stats for safe calorie & macro estimates.' },
  { id: 'lifestyle', title: 'Lifestyle', subtitle: 'Activity, sleep, and daily rhythm.' },
  { id: 'food', title: 'Food preferences', subtitle: 'What you like — and what to avoid.' },
  { id: 'fitness', title: 'Fitness', subtitle: 'Gym experience and weekly availability.' },
  { id: 'health', title: 'Health notes', subtitle: 'Optional caution flags — not a diagnosis.' },
  { id: 'finish', title: 'All set', subtitle: 'Review and start tracking.' },
]

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

type FormState = Record<string, unknown>

const initialForm: FormState = {
  displayName: '',
  age: '',
  gender: '',
  heightCm: '',
  weightKg: '',
  targetWeightKg: '',
  waistCm: '',
  activityLevel: 'moderate',
  jobActivityLevel: 'desk',
  sleepHours: '7',
  dietaryPreference: 'normal',
  allergies: '',
  dislikedFoods: '',
  usualMealTiming: { breakfast: '08:00', lunch: '13:00', dinner: '20:00' },
  gymExperience: 'beginner',
  availableGymDays: ['monday', 'wednesday', 'friday'],
  workoutGoal: 'general_health',
  injuriesPainAreas: '',
  medicalCautionNotes: '',
  supplementUsage: '',
  dailyWaterBaselineMl: '2500',
  caffeineIntake: 'moderate',
  digestionProbioticHabits: '',
  budgetLevel: 'medium',
  preferredFoods: '',
}

export function NutritionOnboardingWizard() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(initialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const progress = Math.round(((step + 1) / STEPS.length) * 100)

  function setField(key: string, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function toggleDay(day: string) {
    const current = (form.availableGymDays as string[]) || []
    setField('availableGymDays', current.includes(day) ? current.filter((d) => d !== day) : [...current, day])
  }

  async function finish() {
    setSaving(true)
    setError(null)
    try {
      await api.saveNutritionProfile({
        displayName: form.displayName,
        age: Number(form.age) || null,
        gender: form.gender,
        heightCm: Number(form.heightCm) || null,
        weightKg: Number(form.weightKg) || null,
        targetWeightKg: Number(form.targetWeightKg) || null,
        waistCm: Number(form.waistCm) || null,
        activityLevel: form.activityLevel,
        jobActivityLevel: form.jobActivityLevel,
        sleepHours: Number(form.sleepHours) || null,
        dietaryPreference: form.dietaryPreference,
        allergies: form.allergies,
        dislikedFoods: form.dislikedFoods,
        usualMealTiming: form.usualMealTiming,
        gymExperience: form.gymExperience,
        availableGymDays: form.availableGymDays,
        workoutGoal: form.workoutGoal,
        goal: form.workoutGoal,
        injuriesPainAreas: form.injuriesPainAreas,
        medicalCautionNotes: form.medicalCautionNotes,
        supplementUsage: form.supplementUsage,
        dailyWaterBaselineMl: Number(form.dailyWaterBaselineMl) || null,
        caffeineIntake: form.caffeineIntake,
        digestionProbioticHabits: form.digestionProbioticHabits,
        budgetLevel: form.budgetLevel,
        preferredFoods: form.preferredFoods,
        onboardingCompleted: true,
        onboardingStep: STEPS.length,
      })
      navigate('/health-fitness/dashboard', { replace: true, state: { onboardingCompleted: true } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile')
    } finally {
      setSaving(false)
    }
  }

  const stepId = STEPS[step]?.id

  const body = useMemo(() => {
    switch (stepId) {
      case 'welcome':
        return (
          <label className="nutrition-wizard-field">
            What should we call you?
            <input value={String(form.displayName)} onChange={(e) => setField('displayName', e.target.value)} placeholder="Your first name" />
          </label>
        )
      case 'body':
        return (
          <div className="nutrition-form-grid">
            <label>Age<input type="number" value={String(form.age)} onChange={(e) => setField('age', e.target.value)} /></label>
            <label>Gender<select value={String(form.gender)} onChange={(e) => setField('gender', e.target.value)}><option value="">Select</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></label>
            <label>Height (cm)<input type="number" value={String(form.heightCm)} onChange={(e) => setField('heightCm', e.target.value)} /></label>
            <label>Current weight (kg)<input type="number" step="0.1" value={String(form.weightKg)} onChange={(e) => setField('weightKg', e.target.value)} /></label>
            <label>Target weight (kg)<input type="number" step="0.1" value={String(form.targetWeightKg)} onChange={(e) => setField('targetWeightKg', e.target.value)} /></label>
            <label>Waist (cm, optional)<input type="number" step="0.1" value={String(form.waistCm)} onChange={(e) => setField('waistCm', e.target.value)} /></label>
          </div>
        )
      case 'lifestyle':
        return (
          <div className="nutrition-form-grid">
            <label>Activity level<select value={String(form.activityLevel)} onChange={(e) => setField('activityLevel', e.target.value)}>{ACTIVITY_LEVELS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
            <label>Job activity<select value={String(form.jobActivityLevel)} onChange={(e) => setField('jobActivityLevel', e.target.value)}><option value="desk">Mostly desk</option><option value="mixed">Mixed</option><option value="active">Active</option><option value="physical">Physical labor</option></select></label>
            <label>Sleep hours/night<input type="number" step="0.5" value={String(form.sleepHours)} onChange={(e) => setField('sleepHours', e.target.value)} /></label>
            <label>Daily water baseline (ml)<input type="number" value={String(form.dailyWaterBaselineMl)} onChange={(e) => setField('dailyWaterBaselineMl', e.target.value)} /></label>
            <label>Caffeine<select value={String(form.caffeineIntake)} onChange={(e) => setField('caffeineIntake', e.target.value)}><option value="none">None</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
          </div>
        )
      case 'food':
        return (
          <div className="nutrition-form-grid">
            <label>Food preference<select value={String(form.dietaryPreference)} onChange={(e) => setField('dietaryPreference', e.target.value)}>{DIETARY_PREFERENCES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></label>
            <label>Budget<select value={String(form.budgetLevel)} onChange={(e) => setField('budgetLevel', e.target.value)}><option value="low">Budget-friendly</option><option value="medium">Medium</option><option value="flexible">Flexible</option></select></label>
            <label className="nutrition-wizard-field--full">Allergies<textarea value={String(form.allergies)} onChange={(e) => setField('allergies', e.target.value)} /></label>
            <label className="nutrition-wizard-field--full">Disliked foods<textarea value={String(form.dislikedFoods)} onChange={(e) => setField('dislikedFoods', e.target.value)} /></label>
            <label className="nutrition-wizard-field--full">Preferred foods<textarea value={String(form.preferredFoods)} onChange={(e) => setField('preferredFoods', e.target.value)} placeholder="e.g. chicken, rice, yogurt, almonds, dates" /></label>
            <label className="nutrition-wizard-field--full">Digestion / probiotic habits<textarea value={String(form.digestionProbioticHabits)} onChange={(e) => setField('digestionProbioticHabits', e.target.value)} /></label>
          </div>
        )
      case 'fitness':
        return (
          <>
            <div className="nutrition-form-grid">
              <label>Gym experience<select value={String(form.gymExperience)} onChange={(e) => setField('gymExperience', e.target.value)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
              <label>Workout goal<select value={String(form.workoutGoal)} onChange={(e) => setField('workoutGoal', e.target.value)}>{GOALS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select></label>
            </div>
            <p className="nutrition-muted">Which days can you train?</p>
            <div className="nutrition-day-picker">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`nutrition-day-chip ${((form.availableGymDays as string[]) || []).includes(d) ? 'active' : ''}`}
                  onClick={() => toggleDay(d)}
                >
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
          </>
        )
      case 'health':
        return (
          <div className="nutrition-form-grid">
            <label className="nutrition-wizard-field--full">Injuries or pain areas<textarea value={String(form.injuriesPainAreas)} onChange={(e) => setField('injuriesPainAreas', e.target.value)} placeholder="e.g. lower back, knee — for workout caution only" /></label>
            <label className="nutrition-wizard-field--full">Medical caution notes<textarea value={String(form.medicalCautionNotes)} onChange={(e) => setField('medicalCautionNotes', e.target.value)} placeholder="Optional notes — not a diagnosis" /></label>
            <label className="nutrition-wizard-field--full">Supplements you use<textarea value={String(form.supplementUsage)} onChange={(e) => setField('supplementUsage', e.target.value)} /></label>
          </div>
        )
      case 'finish':
        return (
          <div className="nutrition-wizard-review">
            <p><strong>Name:</strong> {String(form.displayName || '—')}</p>
            <p><strong>Goal:</strong> {String(form.workoutGoal)} · {String(form.dietaryPreference)}</p>
            <p><strong>Training days:</strong> {((form.availableGymDays as string[]) || []).join(', ') || '—'}</p>
            <p className="nutrition-muted">You can update everything later in Settings.</p>
          </div>
        )
      default:
        return null
    }
  }, [form, stepId])

  return (
    <div className="page nutrition-coach nutrition-wizard">
      <header className="page-header">
        <h1 className="page-title">Set up your coach</h1>
        <p>{STEPS[step]?.subtitle}</p>
      </header>
      <WellnessDisclaimer />
      <div className="nutrition-wizard-progress" aria-label="Wizard progress">
        <div className="nutrition-wizard-progress__bar" style={{ width: `${progress}%` }} />
        <span>{step + 1} / {STEPS.length} · {STEPS[step]?.title}</span>
      </div>
      <div className="nutrition-card nutrition-wizard-step">{body}</div>
      {error && <p role="alert">{error}</p>}
      <div className="nutrition-btn-row">
        <button type="button" className="nutrition-btn" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="nutrition-btn nutrition-btn--primary" onClick={() => setStep((s) => s + 1)}>Continue</button>
        ) : (
          <button type="button" className="nutrition-btn nutrition-btn--primary" disabled={saving} onClick={finish}>{saving ? 'Saving…' : 'Start tracking'}</button>
        )}
      </div>
    </div>
  )
}
