import type { NutritionProfile } from '../hooks/useNutritionCoach'

/** Mirrors backend healthCalculators — wellness estimates only. */
const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  extra: 1.9,
}

function num(v: unknown, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function computeBmi(weightKg: number, heightCm: number) {
  const h = heightCm / 100
  if (h <= 0) return null
  return Math.round((weightKg / (h * h)) * 10) / 10
}

export function computeBmr(profile: Partial<NutritionProfile>) {
  const w = num(profile.weight_kg ?? profile.weightKg)
  const h = num(profile.height_cm ?? profile.heightCm)
  const a = num(profile.age)
  if (!w || !h || !a) return null
  const base = 10 * w + 6.25 * h - 5 * a
  return Math.round(String(profile.gender).toLowerCase() === 'female' ? base - 161 : base + 5)
}

export function computeTdee(profile: Partial<NutritionProfile>) {
  const bmr = computeBmr(profile)
  if (bmr == null) return null
  const mult = ACTIVITY_MULTIPLIERS[String(profile.activity_level ?? profile.activityLevel ?? 'moderate')] || 1.55
  return Math.round(bmr * mult)
}

export function computeCalorieTarget(profile: Partial<NutritionProfile>) {
  const base = computeTdee(profile)
  if (base == null) return null
  const goal = String(profile.goal ?? profile.workout_goal ?? 'maintenance')
  if (goal === 'fat_loss') return Math.round(base * 0.85)
  if (goal === 'muscle_gain') return Math.round(base * 1.1)
  if (goal === 'strength') return Math.round(base * 1.05)
  return base
}

export function computeProteinTarget(profile: Partial<NutritionProfile>) {
  const w = num(profile.weight_kg ?? profile.weightKg)
  if (!w) return null
  const goal = String(profile.goal ?? profile.workout_goal ?? 'maintenance')
  const perKg = goal === 'muscle_gain' || goal === 'strength' ? 1.8 : goal === 'fat_loss' ? 1.6 : 1.2
  return Math.round(w * perKg)
}

export function computeMacroSplit(calories: number, split = { proteinPct: 30, carbPct: 40, fatPct: 30 }) {
  if (!calories) return null
  return {
    proteinG: Math.round((calories * (split.proteinPct / 100)) / 4),
    carbsG: Math.round((calories * (split.carbPct / 100)) / 4),
    fatG: Math.round((calories * (split.fatPct / 100)) / 9),
  }
}

export function computeWaterTarget(profile: Partial<NutritionProfile>) {
  const w = num(profile.weight_kg ?? profile.weightKg)
  return Math.round(w ? w * 35 : 2500)
}

export function computeFiberTarget(calories: number) {
  return Math.max(25, Math.round(((calories || 2200) / 1000) * 14))
}

export function computeIdealWeightRange(heightCm: number, gender?: string) {
  if (!heightCm) return null
  const inches = heightCm / 2.54
  const base = String(gender).toLowerCase() === 'female' ? 45.5 : 50
  const ideal = base + 2.3 * Math.max(0, inches - 60)
  return { minKg: Math.round(ideal * 0.9 * 10) / 10, idealKg: Math.round(ideal * 10) / 10, maxKg: Math.round(ideal * 1.1 * 10) / 10 }
}

export function computeWorkoutCalories(weightKg: number, durationMin: number, met = 6) {
  if (!weightKg || !durationMin) return null
  return Math.round((met * 3.5 * weightKg / 200) * durationMin)
}

export function computePace(current: number, target: number, goal: string) {
  if (!current || !target) return null
  const diff = target - current
  const weekly = goal === 'muscle_gain' ? 0.25 : 0.5
  return { kgDifference: Math.round(diff * 10) / 10, weeklySafeKg: weekly, weeks: Math.ceil(Math.abs(diff) / weekly) }
}

export function computeLiveCalculators(profile: Partial<NutritionProfile> | null, overrides: Partial<NutritionProfile> = {}) {
  const p = { ...(profile || {}), ...overrides }
  const w = num(p.weight_kg ?? p.weightKg)
  const h = num(p.height_cm ?? p.heightCm)
  const calories = computeCalorieTarget(p)
  const protein = computeProteinTarget(p)
  return {
    bmi: w && h ? computeBmi(w, h) : null,
    bmr: computeBmr(p),
    tdee: computeTdee(p),
    calorieTarget: calories,
    proteinTargetG: protein,
    carbTargetG: calories && protein ? Math.max(0, Math.round((calories - protein * 4 - Math.round(calories * 0.28)) / 4)) : null,
    fatTargetG: calories ? Math.round((calories * 0.28) / 9) : null,
    waterTargetMl: computeWaterTarget(p),
    fiberTargetG: computeFiberTarget(calories || 0),
    idealWeightRange: computeIdealWeightRange(h, p.gender),
    workoutCalories: computeWorkoutCalories(w, 45),
    macroSplit: calories ? computeMacroSplit(calories) : null,
    pace: computePace(w, num(p.target_weight_kg ?? p.targetWeightKg), String(p.goal ?? 'maintenance')),
  }
}
