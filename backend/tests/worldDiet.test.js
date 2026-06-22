const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isWorldDietMode,
  buildWorldPlate,
  getWorldDietFoodSuggestions,
  matchesLibraryFilters,
  formatCautionNotes,
  WORLD_DIET_MODES,
  resolveRegion,
} = require('../src/services/nutrition/worldDiet')

const library = [
  {
    id: 1,
    name: 'Dal (lentil curry)',
    origin_region: 'south_asian',
    diet_tags: ['world_diet', 'south_asian', 'vegetarian'],
    nutrient_tags: ['high_protein', 'fiber', 'iron'],
    caution_tags: [],
    tags: ['world_diet'],
    why_recommended: 'South Asian lentil dish with fiber and plant protein.',
    nutrients: { protein: 13, fiber: 9 },
  },
  {
    id: 2,
    name: 'Kimchi',
    origin_region: 'korean',
    diet_tags: ['world_diet', 'korean'],
    nutrient_tags: ['fermented', 'probiotic', 'fiber'],
    caution_tags: ['high_sodium'],
    tags: ['world_diet'],
    nutrients: {},
  },
  {
    id: 3,
    name: 'Salmon (baked)',
    origin_region: 'nordic',
    diet_tags: ['world_diet', 'non_vegetarian'],
    nutrient_tags: ['high_protein', 'omega3'],
    caution_tags: ['allergen_fish'],
    tags: ['protein'],
    nutrients: {},
  },
  {
    id: 4,
    name: 'Green tea',
    origin_region: 'japanese',
    diet_tags: ['world_diet', 'global'],
    nutrient_tags: ['hydration', 'antioxidant_rich'],
    caution_tags: [],
    tags: ['hydration'],
    nutrients: {},
  },
]

test('isWorldDietMode detects world diet variants', () => {
  assert.equal(isWorldDietMode('world_diet'), true)
  assert.equal(isWorldDietMode('world_japanese'), true)
  assert.equal(isWorldDietMode('mediterranean'), false)
  assert.equal(WORLD_DIET_MODES.length, 9)
})

test('resolveRegion maps diet mode to region', () => {
  assert.equal(resolveRegion('world_korean'), 'korean')
  assert.equal(resolveRegion('world_diet'), 'global')
})

test('buildWorldPlate fills world plate slots for Japanese mode', () => {
  const plate = buildWorldPlate(library, { dietary_preference: 'world_japanese' })
  assert.equal(plate.region, 'japanese')
  assert.ok(plate.slots.protein)
  assert.ok(plate.slots.hydration)
  assert.ok(plate.summary)
})

test('getWorldDietFoodSuggestions returns tagged foods', () => {
  const foods = getWorldDietFoodSuggestions(library, 10, 'korean')
  assert.ok(foods.some((f) => f.name.includes('Kimchi')))
})

test('matchesLibraryFilters supports probiotic and vegetarian filters', () => {
  assert.equal(matchesLibraryFilters(library[1], { probiotic: 'true' }), true)
  assert.equal(matchesLibraryFilters(library[2], { vegetarian: 'true' }), false)
  assert.equal(matchesLibraryFilters(library[0], { vegetarian: 'true' }), true)
})

test('formatCautionNotes maps caution tags to guidance', () => {
  const notes = formatCautionNotes(['high_sodium', 'allergen_fish'])
  assert.equal(notes.length, 2)
  assert.match(notes[0], /sodium/i)
})
