'use strict'

/**
 * Website unit tokens to Amazon's unit vocabulary.
 *
 * The target spellings were taken from the uploaded template's own dropdown lists.
 * Those lists are declared per attribute and were verified to be *identical* across
 * every product type in the template, so this table is a marketplace-level vocabulary
 * and carries no subtype dimension: the same conversion is applied to every row.
 *
 * An unrecognised token returns null. The value is then reported as unconverted rather
 * than guessed, because a wrong unit is worse than a blank cell.
 */

const WEIGHT_UNITS = new Map([
  ['mg', 'Milligrams'],
  ['milligram', 'Milligrams'],
  ['milligrams', 'Milligrams'],
  ['g', 'Grams'],
  ['gm', 'Grams'],
  ['gms', 'Grams'],
  ['gr', 'Grams'],
  ['gram', 'Grams'],
  ['grams', 'Grams'],
  ['kg', 'Kilograms'],
  ['kgs', 'Kilograms'],
  ['kilo', 'Kilograms'],
  ['kilos', 'Kilograms'],
  ['kilogram', 'Kilograms'],
  ['kilograms', 'Kilograms'],
  ['oz', 'Ounces'],
  ['ounce', 'Ounces'],
  ['ounces', 'Ounces'],
  ['lb', 'Pounds'],
  ['lbs', 'Pounds'],
  ['pound', 'Pounds'],
  ['pounds', 'Pounds'],
  ['ton', 'Tons'],
  ['tons', 'Tons'],
])

const LENGTH_UNITS = new Map([
  ['mm', 'Millimeters'],
  ['millimeter', 'Millimeters'],
  ['millimeters', 'Millimeters'],
  ['millimetre', 'Millimeters'],
  ['millimetres', 'Millimeters'],
  ['cm', 'Centimeters'],
  ['cms', 'Centimeters'],
  ['centimeter', 'Centimeters'],
  ['centimeters', 'Centimeters'],
  ['centimetre', 'Centimeters'],
  ['centimetres', 'Centimeters'],
  ['m', 'Meters'],
  ['meter', 'Meters'],
  ['meters', 'Meters'],
  ['metre', 'Meters'],
  ['metres', 'Meters'],
  ['in', 'Inches'],
  ['inch', 'Inches'],
  ['inches', 'Inches'],
  ['"', 'Inches'],
  ['ft', 'Feet'],
  ['foot', 'Feet'],
  ['feet', 'Feet'],
])

const VOLUME_UNITS = new Map([
  ['ml', 'Milliliters'],
  ['mls', 'Milliliters'],
  ['milliliter', 'Milliliters'],
  ['milliliters', 'Milliliters'],
  ['millilitre', 'Milliliters'],
  ['millilitres', 'Milliliters'],
  ['cl', 'Centiliters'],
  ['centiliter', 'Centiliters'],
  ['centiliters', 'Centiliters'],
  ['cc', 'Cubic Centimeters'],
  ['l', 'Liters'],
  ['ltr', 'Liters'],
  ['ltrs', 'Liters'],
  ['liter', 'Liters'],
  ['liters', 'Liters'],
  ['litre', 'Liters'],
  ['litres', 'Liters'],
  ['floz', 'Fluid Ounces'],
  ['flozs', 'Fluid Ounces'],
  ['fluidounce', 'Fluid Ounces'],
  ['fluidounces', 'Fluid Ounces'],
  ['gal', 'Gallons'],
  ['gallon', 'Gallons'],
  ['gallons', 'Gallons'],
  ['cup', 'Cups'],
  ['cups', 'Cups'],
])

const DIMENSIONS = { weight: WEIGHT_UNITS, length: LENGTH_UNITS, volume: VOLUME_UNITS }

function normalizeUnitToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/[\s.]+/g, '')
}

/**
 * @param {string} token raw unit text taken from the website value
 * @param {'weight'|'length'|'volume'} dimension which vocabulary to resolve against
 * @returns {string|null} the Amazon spelling, or null when the token is unknown
 */
function toAmazonUnit(token, dimension) {
  const table = DIMENSIONS[dimension]
  if (!table) throw new Error(`Unknown measurement dimension "${dimension}".`)
  const normalized = normalizeUnitToken(token)
  if (!normalized) return null
  return table.get(normalized) || null
}

function isKnownUnit(token, dimension) {
  return toAmazonUnit(token, dimension) !== null
}

module.exports = {
  LENGTH_UNITS,
  VOLUME_UNITS,
  WEIGHT_UNITS,
  isKnownUnit,
  normalizeUnitToken,
  toAmazonUnit,
}
