/**
 * Pure nutrient calculation logic — no DB dependencies (unit-testable).
 */

const {
  NUTRIENT_KEYS,
  COVERAGE_CARD_GROUPS,
  NUTRIENT_FOOD_SUGGESTIONS,
  ACTIVITY_LEVELS,
} = require('./nutrientReferenceData')

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function emptyNutrients() {
  const out = {}
  for (const k of NUTRIENT_KEYS) out[k] = 0
  return out
}

/** Sum nutrients from food log items (nutrients JSON is already the line total) */
function sumNutrientsFromItems(items) {
  const totals = emptyNutrients()
  for (const item of items || []) {
    const n = item.nutrients && typeof item.nutrients === 'object' ? item.nutrients : {}
    for (const key of NUTRIENT_KEYS) {
      totals[key] += toNum(n[key])
    }
  }
  return totals
}

/**
 * Scale library nutrients for a logged quantity.
 * Default: quantity = number of servings (1 banana, 2 eggs).
 * Pass unit g/ml/oz to treat quantity as weight/volume instead.
 */
function scaleNutrients(baseNutrients, quantity, servingSize = 100, unitOrOptions = '') {
  const qty = toNum(quantity) || 1
  let unit = ''
  if (typeof unitOrOptions === 'object' && unitOrOptions) {
    unit = String(unitOrOptions.unit || unitOrOptions.userUnit || '')
  } else {
    unit = String(unitOrOptions || '')
  }
  const massUnits = ['g', 'gram', 'grams', 'ml', 'milliliter', 'millilitre', 'oz', 'lb', 'kg']
  const factor = massUnits.includes(unit.toLowerCase())
    ? (servingSize > 0 ? qty / servingSize : qty)
    : qty
  const out = {}
  const base = baseNutrients && typeof baseNutrients === 'object' ? baseNutrients : {}
  for (const key of NUTRIENT_KEYS) {
    out[key] = toNum(base[key]) * factor
  }
  return out
}

function findActivityMultiplier(level) {
  const found = ACTIVITY_LEVELS.find((a) => a.value === level)
  return found ? found.multiplier : 1.375
}

/** Estimate calorie/protein targets from profile + DB targets */
function personalizeTargets(profile, dbTargets) {
  const targets = {}
  const byKey = {}
  for (const row of dbTargets || []) {
    byKey[row.nutrient_key] = row
  }

  for (const key of NUTRIENT_KEYS) {
    const row = byKey[key]
    if (!row) continue
    let target = toNum(row.default_target)
    const overrides = row.goal_overrides && typeof row.goal_overrides === 'object' ? row.goal_overrides : {}
    if (profile?.goal && overrides[profile.goal] != null) {
      target = toNum(overrides[profile.goal])
    }
    targets[key] = {
      target,
      min: row.min_target != null ? toNum(row.min_target) : null,
      max: row.max_target != null ? toNum(row.max_target) : null,
      unit: row.unit || '',
      displayName: row.display_name || key,
      referenceSource: row.reference_source || '',
    }
  }

  if (profile?.weight_kg && profile?.height_cm && profile?.age) {
    const weight = toNum(profile.weight_kg)
    const height = toNum(profile.height_cm)
    const age = toNum(profile.age)
    const gender = String(profile.gender || 'male').toLowerCase()
    const bmr =
      gender === 'female'
        ? 10 * weight + 6.25 * height - 5 * age - 161
        : 10 * weight + 6.25 * height - 5 * age + 5
    const tdee = bmr * findActivityMultiplier(profile.activity_level)
    let calories = Math.round(tdee)
    if (profile.goal === 'fat_loss') calories = Math.round(tdee * 0.85)
    if (profile.goal === 'muscle_gain') calories = Math.round(tdee * 1.1)
    if (profile.goal === 'strength') calories = Math.round(tdee * 1.05)
    targets.calories = { ...(targets.calories || {}), target: calories, unit: 'kcal', displayName: 'Calories' }
    const proteinPerKg = profile.goal === 'muscle_gain' || profile.goal === 'strength' ? 1.8 : 1.2
    targets.protein = {
      ...(targets.protein || {}),
      target: Math.round(weight * proteinPerKg),
      unit: 'g',
      displayName: 'Protein',
    }
  }

  return targets
}

/**
 * Status for a single nutrient:
 * - low: below min or <80% of target
 * - okay: within range
 * - high: above max
 * - needs_attention: sodium/saturated fat/cholesterol over max
 */
function nutrientStatus(intake, targetInfo) {
  const t = toNum(targetInfo?.target)
  const min = targetInfo?.min != null ? toNum(targetInfo.min) : null
  const max = targetInfo?.max != null ? toNum(targetInfo.max) : null
  const intakeVal = toNum(intake)

  if (max != null && intakeVal > max * 1.05) return 'high'
  if (min != null && intakeVal < min) return 'low'
  if (t > 0 && intakeVal < t * 0.8) return 'low'
  if (t > 0 && intakeVal > t * 1.2 && max == null) return 'high'
  if (max != null && intakeVal > max * 0.9) return 'needs_attention'
  return 'okay'
}

function pctCovered(intake, target) {
  const t = toNum(target)
  if (t <= 0) return intake > 0 ? 100 : 0
  return Math.min(200, Math.round((toNum(intake) / t) * 100))
}

function buildCoverage(totals, targets) {
  const coverage = {}
  const missing = []

  for (const key of NUTRIENT_KEYS) {
    const targetInfo = targets[key]
    if (!targetInfo) continue
    const intake = toNum(totals[key])
    const status = nutrientStatus(intake, targetInfo)
    const pct = pctCovered(intake, targetInfo.target)
    coverage[key] = {
      intake,
      target: targetInfo.target,
      min: targetInfo.min,
      max: targetInfo.max,
      unit: targetInfo.unit,
      displayName: targetInfo.displayName,
      pct,
      status,
    }
    if (status === 'low') {
      missing.push({
        key,
        displayName: targetInfo.displayName,
        intake,
        target: targetInfo.target,
        pct,
        suggestions: NUTRIENT_FOOD_SUGGESTIONS[key] || [],
      })
    }
  }

  return { coverage, missingNutrients: missing }
}

function buildCoverageCards(coverage) {
  return COVERAGE_CARD_GROUPS.map((group) => {
    const entries = group.nutrients.map((k) => coverage[k]).filter(Boolean)
    if (entries.length === 0) return null
    const avgPct = Math.round(entries.reduce((s, e) => s + e.pct, 0) / entries.length)
    const statuses = entries.map((e) => e.status)
    let status = 'okay'
    if (statuses.includes('high')) status = 'high'
    else if (statuses.includes('needs_attention')) status = 'needs_attention'
    else if (statuses.includes('low')) status = 'low'
    return {
      key: group.key,
      label: group.label,
      pct: avgPct,
      status,
      nutrients: entries,
    }
  }).filter(Boolean)
}

/** Simple food quality score 0–100 based on coverage of key nutrients */
function foodQualityScore(coverage) {
  const keys = ['protein', 'fiber', 'potassium', 'magnesium', 'vitaminC', 'vitaminD', 'omega3']
  let score = 0
  let count = 0
  for (const k of keys) {
    const c = coverage[k]
    if (!c) continue
    count++
    if (c.status === 'okay') score += 100
    else if (c.status === 'low') score += Math.max(0, c.pct)
    else if (c.status === 'high' || c.status === 'needs_attention') score += 40
  }
  return count > 0 ? Math.round(score / count) : 0
}

function computeDailySummary({ items, profile, dbTargets }) {
  const totals = sumNutrientsFromItems(items)
  const targets = personalizeTargets(profile, dbTargets)
  const { coverage, missingNutrients } = buildCoverage(totals, targets)
  const cards = buildCoverageCards(coverage)
  const foodQuality = foodQualityScore(coverage)
  return {
    totals,
    targets,
    coverage,
    cards,
    missingNutrients,
    foodQualityScore: foodQuality,
    hydrationMl: totals.waterMl,
  }
}

module.exports = {
  NUTRIENT_KEYS,
  emptyNutrients,
  sumNutrientsFromItems,
  scaleNutrients,
  personalizeTargets,
  nutrientStatus,
  pctCovered,
  buildCoverage,
  buildCoverageCards,
  foodQualityScore,
  computeDailySummary,
}
