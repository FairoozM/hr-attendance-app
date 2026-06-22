const test = require('node:test')
const assert = require('node:assert/strict')
const {
  sumNutrientsFromItems,
  scaleNutrients,
  nutrientStatus,
  pctCovered,
  computeDailySummary,
  buildCoverageCards,
  foodQualityScore,
} = require('../src/services/nutrition/nutrientCalculation')
const { DEFAULT_NUTRIENT_TARGETS } = require('../src/services/nutrition/nutrientReferenceData')

test('sumNutrientsFromItems aggregates line totals without double-counting quantity', () => {
  const items = [
    { quantity: 1, nutrients: { protein: 6, calories: 72, fiber: 0 } },
    { quantity: 2, nutrients: { protein: 20, calories: 50, fiber: 3 } },
  ]
  const totals = sumNutrientsFromItems(items)
  assert.equal(totals.protein, 26)
  assert.equal(totals.calories, 122)
  assert.equal(totals.fiber, 3)
})

test('scaleNutrients scales by grams when unit is g', () => {
  const base = { protein: 31, calories: 165 }
  const scaled = scaleNutrients(base, 200, 100, 'g')
  assert.equal(scaled.protein, 62)
  assert.equal(scaled.calories, 330)
})

test('scaleNutrients treats quantity as servings by default', () => {
  const base = { protein: 10, calories: 89 }
  const oneBanana = scaleNutrients(base, 1, 100)
  const twoBananas = scaleNutrients(base, 2, 100)
  assert.equal(oneBanana.calories, 89)
  assert.equal(twoBananas.calories, 178)
})

test('nutrientStatus returns low when below 80% of target', () => {
  assert.equal(nutrientStatus(40, { target: 90, min: 50 }), 'low')
  assert.equal(nutrientStatus(85, { target: 90, min: 50 }), 'okay')
})

test('nutrientStatus returns high when above max', () => {
  assert.equal(nutrientStatus(2500, { target: 2300, max: 2300 }), 'high')
})

test('pctCovered caps at 200%', () => {
  assert.equal(pctCovered(180, 90), 200)
  assert.equal(pctCovered(45, 90), 50)
})

test('computeDailySummary identifies missing nutrients', () => {
  const profile = { age: 30, gender: 'male', weight_kg: 80, height_cm: 175, activity_level: 'moderate', goal: 'muscle_gain' }
  const items = [
    { quantity: 1, nutrients: { protein: 6, calories: 72, fiber: 0, potassium: 69, waterMl: 38 } },
  ]
  const summary = computeDailySummary({ items, profile, dbTargets: DEFAULT_NUTRIENT_TARGETS })
  assert.ok(summary.totals.protein >= 6)
  assert.ok(Array.isArray(summary.missingNutrients))
  assert.ok(summary.missingNutrients.length > 0)
  assert.ok(summary.foodQualityScore >= 0 && summary.foodQualityScore <= 100)
})

test('buildCoverageCards groups nutrients into cards', () => {
  const coverage = {
    protein: { pct: 90, status: 'okay', intake: 81, target: 90, displayName: 'Protein' },
    potassium: { pct: 40, status: 'low', intake: 100, target: 3400, displayName: 'Potassium' },
  }
  const cards = buildCoverageCards(coverage)
  assert.ok(cards.some((c) => c.key === 'protein'))
  assert.ok(cards.some((c) => c.key === 'potassium' && c.status === 'low'))
})

test('foodQualityScore reflects coverage mix', () => {
  const good = {
    protein: { status: 'okay', pct: 100 },
    fiber: { status: 'okay', pct: 100 },
    potassium: { status: 'okay', pct: 100 },
    magnesium: { status: 'okay', pct: 100 },
    vitaminC: { status: 'okay', pct: 100 },
    vitaminD: { status: 'okay', pct: 100 },
    omega3: { status: 'okay', pct: 100 },
  }
  assert.equal(foodQualityScore(good), 100)
})
