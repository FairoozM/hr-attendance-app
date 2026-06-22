const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isMediterraneanMode,
  buildMediterraneanPlate,
  analyzeFatIntake,
  getFatGuidanceForFood,
  MEDITERRANEAN_DIET_MODES,
} = require('../src/services/nutrition/mediterraneanDiet')

const library = [
  { id: 1, name: 'Chicken breast (grilled)', image_url: 'x', tags: ['protein', 'mediterranean'], nutrients: {} },
  { id: 2, name: 'Brown rice (cooked)', image_url: 'x', tags: ['mediterranean', 'carbs'], nutrients: {} },
  { id: 3, name: 'Olive oil', image_url: 'x', tags: ['mediterranean', 'good-fats'], nutrients: { fat: 13.5, saturatedFat: 1.9, calories: 119 } },
  { id: 4, name: 'Greek yogurt (plain)', image_url: 'x', tags: ['mediterranean', 'probiotics'], nutrients: {} },
  { id: 5, name: 'Almonds', image_url: 'x', tags: ['mediterranean', 'good-fats'], nutrients: {} },
  { id: 6, name: 'Cucumber', image_url: 'x', tags: ['mediterranean', 'vegetables'], nutrients: {} },
  { id: 7, name: 'Tahini (sesame paste)', image_url: 'x', tags: ['mediterranean', 'good-fats'], nutrients: { fat: 8, saturatedFat: 1.1, magnesium: 14, calcium: 64, calories: 89 } },
  { id: 8, name: 'Desi ghee (clarified butter)', image_url: 'x', tags: ['mediterranean', 'traditional-fat'], nutrients: { fat: 10, saturatedFat: 6.5, calories: 90 } },
]

test('isMediterraneanMode detects mediterranean variants', () => {
  assert.equal(isMediterraneanMode('mediterranean'), true)
  assert.equal(isMediterraneanMode('mediterranean_fat_loss'), true)
  assert.equal(isMediterraneanMode('normal'), false)
  assert.equal(MEDITERRANEAN_DIET_MODES.length, 4)
})

test('buildMediterraneanPlate fills all plate slots', () => {
  const plate = buildMediterraneanPlate(library, { dietary_preference: 'mediterranean' })
  assert.ok(plate.slots.protein)
  assert.ok(plate.slots.healthyFat)
  assert.ok(plate.slots.probiotic)
  assert.ok(plate.summary.includes('+'))
})

test('getFatGuidanceForFood identifies olive oil and ghee differently', () => {
  const olive = getFatGuidanceForFood('Olive oil')
  const ghee = getFatGuidanceForFood('Desi ghee (clarified butter)')
  assert.equal(olive.category, 'healthy_unsaturated')
  assert.equal(ghee.category, 'traditional_saturated')
  assert.ok(ghee.caution)
})

test('analyzeFatIntake separates healthy and traditional fat sources', () => {
  const totals = { fat: 23.5, saturatedFat: 8.4, omega3: 0.1, calories: 300 }
  const items = [
    { food_name: 'Olive oil', quantity: 1, nutrients: { fat: 13.5, saturatedFat: 1.9, calories: 119 } },
    { food_name: 'Desi ghee (clarified butter)', quantity: 1, nutrients: { fat: 10, saturatedFat: 6.5, calories: 90 } },
  ]
  const analysis = analyzeFatIntake(totals, items)
  assert.equal(analysis.healthyUnsaturatedSources.length, 1)
  assert.equal(analysis.traditionalSaturatedSources.length, 1)
  assert.ok(analysis.unsaturatedEstimateG > 0)
})
