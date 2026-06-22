const test = require('node:test')
const assert = require('node:assert/strict')
const {
  bmi,
  bmrMifflin,
  tdee,
  calorieTarget,
  proteinTargetG,
  waterTargetMl,
  fiberTargetG,
  idealWeightRangeKg,
  computeAllCalculators,
} = require('../src/services/nutrition/healthCalculators')

const profile = {
  age: 30,
  gender: 'male',
  weight_kg: 80,
  height_cm: 175,
  activity_level: 'moderate',
  goal: 'muscle_gain',
  target_weight_kg: 85,
}

test('healthCalculators BMI', () => {
  const v = bmi(80, 175)
  assert.ok(v > 20 && v < 30)
})

test('healthCalculators BMR and TDEE', () => {
  const bmr = bmrMifflin(profile)
  assert.ok(bmr > 1500)
  const t = tdee(profile)
  assert.ok(t > bmr)
})

test('healthCalculators targets respond to goal', () => {
  const gain = calorieTarget(profile)
  const loss = calorieTarget({ ...profile, goal: 'fat_loss' })
  assert.ok(gain > loss)
  assert.ok(proteinTargetG(profile) >= 96)
})

test('healthCalculators water and fiber', () => {
  assert.ok(waterTargetMl(profile) >= 2500)
  assert.ok(fiberTargetG(2200) >= 25)
})

test('healthCalculators ideal weight range', () => {
  const range = idealWeightRangeKg(175, 'male')
  assert.ok(range.minKg < range.idealKg && range.idealKg < range.maxKg)
})

test('computeAllCalculators returns full snapshot', () => {
  const all = computeAllCalculators(profile)
  assert.ok(all.bmi)
  assert.ok(all.tdee)
  assert.ok(all.macroSplit.proteinG)
})
