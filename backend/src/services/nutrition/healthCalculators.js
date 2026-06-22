/**
 * Health calculator utilities — wellness estimates only, not medical advice.
 */

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  extra: 1.9,
}

const JOB_ACTIVITY_BONUS = {
  desk: 0,
  mixed: 0.05,
  active: 0.1,
  physical: 0.15,
}

function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function bmi(weightKg, heightCm) {
  const h = num(heightCm) / 100
  if (h <= 0) return null
  const v = num(weightKg) / (h * h)
  return Math.round(v * 10) / 10
}

function bmiCategory(bmiVal) {
  if (bmiVal == null) return '—'
  if (bmiVal < 18.5) return 'Underweight range'
  if (bmiVal < 25) return 'Healthy range'
  if (bmiVal < 30) return 'Overweight range'
  return 'Higher BMI range — consult a professional for personal guidance'
}

function bmrMifflin(profile) {
  const p = profile && typeof profile === 'object' ? profile : {}
  const w = num(p.weightKg ?? p.weight_kg)
  const h = num(p.heightCm ?? p.height_cm)
  const a = num(p.age)
  if (!w || !h || !a) return null
  const g = String(p.gender || 'male').toLowerCase()
  const base = 10 * w + 6.25 * h - 5 * a
  return Math.round(g === 'female' ? base - 161 : base + 5)
}

function activityMultiplier(activityLevel, jobActivityLevel) {
  const base = ACTIVITY_MULTIPLIERS[activityLevel] || ACTIVITY_MULTIPLIERS.moderate
  const bonus = JOB_ACTIVITY_BONUS[jobActivityLevel] || 0
  return Math.round((base + bonus) * 1000) / 1000
}

function tdee(profile) {
  const bmr = bmrMifflin(profile)
  if (bmr == null) return null
  const mult = activityMultiplier(profile.activityLevel || profile.activity_level, profile.jobActivityLevel || profile.job_activity_level)
  return Math.round(bmr * mult)
}

function calorieTarget(profile) {
  const base = tdee(profile)
  if (base == null) return null
  const goal = profile.goal || profile.workoutGoal || profile.workout_goal || 'maintenance'
  if (goal === 'fat_loss') return Math.round(base * 0.85)
  if (goal === 'muscle_gain') return Math.round(base * 1.1)
  if (goal === 'strength') return Math.round(base * 1.05)
  return base
}

function proteinTargetG(profile) {
  const w = num(profile.weightKg || profile.weight_kg)
  if (!w) return null
  const goal = profile.goal || profile.workout_goal || 'maintenance'
  const perKg = goal === 'muscle_gain' || goal === 'strength' ? 1.8 : goal === 'fat_loss' ? 1.6 : 1.2
  return Math.round(w * perKg)
}

function macroSplit(calories, split = { proteinPct: 30, carbPct: 40, fatPct: 30 }) {
  const cals = num(calories)
  if (!cals) return null
  const pPct = num(split.proteinPct, 30)
  const cPct = num(split.carbPct, 40)
  const fPct = num(split.fatPct, 30)
  return {
    proteinG: Math.round((cals * (pPct / 100)) / 4),
    carbsG: Math.round((cals * (cPct / 100)) / 4),
    fatG: Math.round((cals * (fPct / 100)) / 9),
    split: { proteinPct: pPct, carbPct: cPct, fatPct: fPct },
  }
}

function carbTargetG(profile, calories) {
  const cals = num(calories) || calorieTarget(profile)
  const protein = proteinTargetG(profile) || 0
  const fatG = Math.round(((cals || 0) * 0.28) / 9)
  const used = protein * 4 + fatG * 9
  return Math.max(0, Math.round((cals - used) / 4))
}

function fatTargetG(profile, calories) {
  const cals = num(calories) || calorieTarget(profile)
  return Math.round(((cals || 0) * 0.28) / 9)
}

function waterTargetMl(profile) {
  const w = num(profile.weightKg || profile.weight_kg)
  const base = w ? w * 35 : 2500
  const activity = profile.activityLevel || profile.activity_level
  const bonus = activity === 'active' || activity === 'extra' ? 500 : activity === 'moderate' ? 250 : 0
  const sleep = num(profile.sleepHours || profile.sleep_hours, 7)
  const sleepAdj = sleep < 6 ? 250 : 0
  return Math.round(base + bonus + sleepAdj)
}

function fiberTargetG(calories) {
  const cals = num(calories) || 2200
  return Math.max(25, Math.round((cals / 1000) * 14))
}

function idealWeightRangeKg(heightCm, gender) {
  const h = num(heightCm)
  if (!h) return null
  const inches = h / 2.54
  const g = String(gender || 'male').toLowerCase()
  const base = g === 'female' ? 45.5 : 50
  const perInch = 2.3
  const ideal = base + perInch * Math.max(0, inches - 60)
  return {
    minKg: Math.round((ideal * 0.9) * 10) / 10,
    idealKg: Math.round(ideal * 10) / 10,
    maxKg: Math.round((ideal * 1.1) * 10) / 10,
  }
}

function workoutCaloriesEstimate({ weightKg, durationMin, met = 6 }) {
  const w = num(weightKg)
  const mins = num(durationMin)
  if (!w || !mins) return null
  return Math.round((met * 3.5 * w / 200) * mins)
}

function paceCalculator({ currentWeightKg, targetWeightKg, goal }) {
  const current = num(currentWeightKg)
  const target = num(targetWeightKg)
  if (!current || !target) return null
  const diff = target - current
  const weeklySafe = goal === 'muscle_gain' ? 0.25 : 0.5
  const weeks = Math.abs(diff) / weeklySafe
  return {
    kgDifference: Math.round(diff * 10) / 10,
    suggestedWeeklyPaceKg: weeklySafe,
    estimatedWeeks: Math.ceil(weeks),
    note: 'General wellness pace only — not a medical weight-loss prescription.',
  }
}

function computeAllCalculators(profile) {
  const bmiVal = bmi(profile.weightKg || profile.weight_kg, profile.heightCm || profile.height_cm)
  const bmr = bmrMifflin(profile)
  const tdeeVal = tdee(profile)
  const calories = calorieTarget(profile)
  const protein = proteinTargetG(profile)
  const macros = macroSplit(calories)
  return {
    bmi: bmiVal,
    bmiCategory: bmiCategory(bmiVal),
    bmr,
    tdee: tdeeVal,
    calorieTarget: calories,
    proteinTargetG: protein,
    carbTargetG: carbTargetG(profile, calories),
    fatTargetG: fatTargetG(profile, calories),
    waterTargetMl: waterTargetMl(profile),
    fiberTargetG: fiberTargetG(calories),
    idealWeightRange: idealWeightRangeKg(profile.heightCm || profile.height_cm, profile.gender),
    workoutCaloriesEstimate: workoutCaloriesEstimate({
      weightKg: profile.weightKg || profile.weight_kg,
      durationMin: 45,
      met: 6,
    }),
    macroSplit: macros,
    pace: paceCalculator({
      currentWeightKg: profile.weightKg || profile.weight_kg,
      targetWeightKg: profile.targetWeightKg || profile.target_weight_kg,
      goal: profile.goal || profile.workout_goal,
    }),
    activityMultiplier: activityMultiplier(profile.activityLevel || profile.activity_level, profile.jobActivityLevel || profile.job_activity_level),
  }
}

module.exports = {
  ACTIVITY_MULTIPLIERS,
  bmi,
  bmiCategory,
  bmrMifflin,
  tdee,
  calorieTarget,
  proteinTargetG,
  macroSplit,
  carbTargetG,
  fatTargetG,
  waterTargetMl,
  fiberTargetG,
  idealWeightRangeKg,
  workoutCaloriesEstimate,
  paceCalculator,
  computeAllCalculators,
}
