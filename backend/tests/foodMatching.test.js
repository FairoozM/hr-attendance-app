const test = require('node:test')
const assert = require('node:assert/strict')
const { findLibraryFoodByName } = require('../src/services/nutrition/foodMatching')

const library = [
  { id: 1, name: 'Eggs (whole, large)', nutrients: { calories: 72 } },
  { id: 2, name: 'Banana', nutrients: { calories: 89 } },
  { id: 3, name: 'Apple', nutrients: { calories: 52 } },
  { id: 4, name: 'Granola', nutrients: { calories: 240 } },
  { id: 5, name: 'Bitter gourd (karela)', nutrients: { calories: 17 } },
  { id: 6, name: 'Rye bread', nutrients: { calories: 95 } },
]

test('findLibraryFoodByName matches plurals and free text', () => {
  assert.equal(findLibraryFoodByName(library, 'apple')?.name, 'Apple')
  assert.equal(findLibraryFoodByName(library, '2 eggs')?.name, 'Eggs (whole, large)')
  assert.equal(findLibraryFoodByName(library, 'granola')?.name, 'Granola')
  assert.equal(findLibraryFoodByName(library, 'bitter gourd')?.name, 'Bitter gourd (karela)')
})
