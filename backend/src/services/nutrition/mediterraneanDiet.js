/**
 * Mediterranean diet mode — food lists, plate builder, and fat-source guidance.
 * Wellness tracking only; based on general Mediterranean dietary pattern references.
 */

const MEDITERRANEAN_DIET_MODES = [
  { value: 'mediterranean', label: 'Mediterranean Diet', goalDefault: 'general_health', proteinBias: 1.0 },
  { value: 'mediterranean_high_protein', label: 'High Protein Mediterranean', goalDefault: 'muscle_gain', proteinBias: 1.2 },
  { value: 'mediterranean_fat_loss', label: 'Weight Loss Mediterranean', goalDefault: 'fat_loss', proteinBias: 1.1 },
  { value: 'mediterranean_muscle_gain', label: 'Muscle Gain Mediterranean', goalDefault: 'muscle_gain', proteinBias: 1.25 },
]

const MEDITERRANEAN_FOOD_KEYWORDS = [
  'olive oil', 'tahini', 'hummus', 'chickpeas', 'lentils', 'beans', 'greek yogurt', 'kefir',
  'fish', 'salmon', 'eggs', 'chicken', 'olives', 'avocado', 'almonds', 'walnuts', 'pistachios',
  'dates', 'raisins', 'oats', 'brown rice', 'rice', 'spinach', 'broccoli', 'cucumber', 'tomato',
  'sesame', 'feta', 'whole grain', 'banana', 'mixed nuts',
]

/** Metadata for fat-source education (not medical claims) */
const FAT_SOURCE_GUIDANCE = {
  'olive oil': {
    category: 'healthy_unsaturated',
    highlight: 'Primary Mediterranean healthy fat — mostly unsaturated.',
    portionNote: 'Typical drizzle: 1 tbsp (~15 ml) per meal.',
  },
  tahini: {
    category: 'healthy_unsaturated',
    highlight: 'Sesame-based fat with magnesium, calcium, and calorie density.',
    portionNote: '1–2 tbsp adds healthy fats — measure portions for calorie awareness.',
  },
  avocado: {
    category: 'healthy_unsaturated',
    highlight: 'Monounsaturated fats plus fiber and potassium.',
    portionNote: 'About 1/2 avocado is a common serving.',
  },
  olives: {
    category: 'healthy_unsaturated',
    highlight: 'Mediterranean fat source — watch sodium in brined olives.',
    portionNote: 'Small handful (~8–10 olives) is a typical snack portion.',
  },
  almonds: { category: 'healthy_unsaturated', highlight: 'Nuts provide unsaturated fats, vitamin E, and magnesium.', portionNote: 'Small handful (~28 g).' },
  walnuts: { category: 'healthy_unsaturated', highlight: 'Omega-3 ALA from plant fats.', portionNote: 'Small handful (~28 g).' },
  pistachios: { category: 'healthy_unsaturated', highlight: 'Nuts/seeds topping for Mediterranean plates.', portionNote: 'Small handful (~28 g).' },
  'mixed nuts': { category: 'healthy_unsaturated', highlight: 'Nuts/seeds mix for healthy fats.', portionNote: 'Small handful (~28 g).' },
  hummus: { category: 'healthy_unsaturated', highlight: 'Chickpeas + tahini — fiber, protein, and healthy fats.', portionNote: '1/4–1/2 cup with vegetables.' },
  'desi ghee': {
    category: 'traditional_saturated',
    highlight: 'Optional traditional fat — calorie dense and higher in saturated fat.',
    portionNote: 'Use small amounts for flavor; prioritize olive oil for daily healthy fats.',
    caution: 'Portion control recommended — high calorie density.',
  },
  'sesame seeds': {
    category: 'healthy_unsaturated',
    highlight: 'Sesame nutrients including magnesium and calcium.',
    portionNote: '1 tbsp topping on salads or bowls.',
  },
}

const PLATE_SLOTS = [
  { key: 'protein', label: 'Protein', examples: ['chicken', 'fish', 'salmon', 'eggs', 'lentils', 'chickpeas'] },
  { key: 'vegetables', label: 'Vegetables', examples: ['spinach', 'broccoli', 'cucumber', 'tomato', 'salad'] },
  { key: 'wholeGrain', label: 'Whole grain / carb', examples: ['brown rice', 'oats', 'whole grain', 'rice'] },
  { key: 'healthyFat', label: 'Healthy fat', examples: ['olive oil', 'tahini', 'avocado', 'olives', 'almonds'] },
  { key: 'probiotic', label: 'Probiotic side', examples: ['greek yogurt', 'kefir', 'yogurt'] },
  { key: 'nutsSeeds', label: 'Nuts / seeds topping', examples: ['almonds', 'walnuts', 'sesame', 'pistachios', 'mixed nuts'] },
]

const EXAMPLE_PLATE = {
  title: 'Sample Mediterranean plate',
  description: 'Chicken + brown rice + cucumber/tomato salad + olive oil + tahini yogurt sauce + almonds.',
  slots: {
    protein: 'Chicken breast (grilled)',
    vegetables: 'Cucumber & tomato salad',
    wholeGrain: 'Brown rice',
    healthyFat: 'Olive oil drizzle + tahini yogurt sauce',
    probiotic: 'Greek yogurt (plain)',
    nutsSeeds: 'Almonds',
  },
}

function isMediterraneanMode(dietaryPreference) {
  const d = String(dietaryPreference || '')
  return d === 'mediterranean' || d.startsWith('mediterranean_')
}

function mediterraneanModeConfig(dietaryPreference) {
  return MEDITERRANEAN_DIET_MODES.find((m) => m.value === dietaryPreference) || MEDITERRANEAN_DIET_MODES[0]
}

function findLibraryMatches(library, keywords, limit = 1) {
  const out = []
  for (const kw of keywords) {
    const match = library.find((f) => String(f.name).toLowerCase().includes(kw))
    if (match && !out.some((o) => o.id === match.id)) {
      out.push({
        id: match.id,
        name: match.name,
        image_url: match.image_url,
        nutrients: match.nutrients,
        tags: match.tags,
      })
    }
    if (out.length >= limit) break
  }
  return out
}

function buildMediterraneanPlate(library, profile = {}) {
  const mode = mediterraneanModeConfig(profile.dietary_preference || profile.dietaryPreference)
  const plate = { mode: mode.label, slots: {}, example: EXAMPLE_PLATE, disclaimer: 'Plate builder for wellness planning only — not medical advice.' }

  for (const slot of PLATE_SLOTS) {
    let keywords = [...slot.examples]
    if (mode.value === 'mediterranean_high_protein' || mode.value === 'mediterranean_muscle_gain') {
      if (slot.key === 'protein') keywords = ['chicken', 'fish', 'salmon', 'eggs', 'greek yogurt', 'lentils']
    }
    if (mode.value === 'mediterranean_fat_loss' && slot.key === 'wholeGrain') {
      keywords = ['oats', 'brown rice', 'vegetables', 'lentils']
    }
    const matches = findLibraryMatches(library, keywords, 2)
    plate.slots[slot.key] = {
      label: slot.label,
      items: matches,
      suggestion: matches[0]?.name || slot.examples[0],
    }
  }

  plate.summary = Object.values(plate.slots).map((s) => s.suggestion).filter(Boolean).join(' + ')
  return plate
}

function getMediterraneanFoodSuggestions(library, limit = 12) {
  const scored = library.filter((f) => {
    const name = String(f.name).toLowerCase()
    const tags = (f.tags || []).join(' ').toLowerCase()
    return f.tags?.includes('mediterranean') || MEDITERRANEAN_FOOD_KEYWORDS.some((k) => name.includes(k) || tags.includes(k))
  })
  return scored.slice(0, limit).map((f) => ({
    id: f.id,
    name: f.name,
    image_url: f.image_url,
    tags: f.tags,
  }))
}

function getFatGuidanceForFood(foodName) {
  const lower = String(foodName || '').toLowerCase()
  for (const [key, meta] of Object.entries(FAT_SOURCE_GUIDANCE)) {
    if (lower.includes(key)) return { food: key, ...meta }
  }
  return null
}

function analyzeFatIntake(totals, items = []) {
  const t = totals || {}
  const totalFat = Number(t.fat || 0)
  const saturatedFat = Number(t.saturatedFat || 0)
  const omega3 = Number(t.omega3 || 0)
  const unsaturatedEstimate = Math.max(0, totalFat - saturatedFat)
  const calories = Number(t.calories || 0)
  const fatCalories = totalFat * 9
  const calorieDensityFromFat = calories > 0 ? Math.round((fatCalories / calories) * 100) : 0

  const sources = []
  for (const item of items || []) {
    const guidance = getFatGuidanceForFood(item.food_name || item.foodName)
    if (!guidance) continue
    const n = item.nutrients || {}
    sources.push({
      foodName: item.food_name || item.foodName,
      category: guidance.category,
      highlight: guidance.highlight,
      portionNote: guidance.portionNote,
      caution: guidance.caution || null,
      fatG: Number(n.fat || 0) * Number(item.quantity || 1),
      saturatedFatG: Number(n.saturatedFat || 0) * Number(item.quantity || 1),
      calories: Number(n.calories || 0) * Number(item.quantity || 1),
    })
  }

  return {
    totalFatG: Math.round(totalFat * 10) / 10,
    saturatedFatG: Math.round(saturatedFat * 10) / 10,
    unsaturatedEstimateG: Math.round(unsaturatedEstimate * 10) / 10,
    omega3G: Math.round(omega3 * 10) / 10,
    calorieDensityFromFatPct: calorieDensityFromFat,
    healthyUnsaturatedSources: sources.filter((s) => s.category === 'healthy_unsaturated'),
    traditionalSaturatedSources: sources.filter((s) => s.category === 'traditional_saturated'),
    comparisonNote: 'Compare total fat, saturated fat, and unsaturated fats for balance. Mediterranean pattern emphasizes olive oil, nuts, and fish over saturated fat sources.',
    oliveOilNote: 'Olive oil is the main Mediterranean healthy fat — prefer over calorie-dense saturated options for daily cooking.',
    gheeNote: 'Desi ghee is optional traditional fat — use small portions; it is calorie dense and higher in saturated fat.',
  }
}

function mediterraneanNutrientSuggestions() {
  return {
    ...require('./nutrientReferenceData').NUTRIENT_FOOD_SUGGESTIONS,
    omega3: ['salmon', 'fish', 'walnuts', 'olive oil', 'tahini'],
    fat: ['olive oil', 'tahini', 'avocado', 'almonds', 'olives', 'hummus'],
    protein: ['fish', 'chicken', 'eggs', 'Greek yogurt', 'chickpeas', 'lentils', 'hummus'],
    fiber: ['chickpeas', 'lentils', 'oats', 'vegetables', 'brown rice', 'broccoli'],
    calcium: ['Greek yogurt', 'feta cheese', 'tahini', 'sesame seeds', 'almonds'],
    magnesium: ['almonds', 'tahini', 'spinach', 'chickpeas', 'sesame seeds'],
    probiotics: ['Greek yogurt', 'kefir'],
  }
}

module.exports = {
  MEDITERRANEAN_DIET_MODES,
  MEDITERRANEAN_FOOD_KEYWORDS,
  FAT_SOURCE_GUIDANCE,
  PLATE_SLOTS,
  EXAMPLE_PLATE,
  isMediterraneanMode,
  mediterraneanModeConfig,
  buildMediterraneanPlate,
  getMediterraneanFoodSuggestions,
  getFatGuidanceForFood,
  analyzeFatIntake,
  mediterraneanNutrientSuggestions,
}
