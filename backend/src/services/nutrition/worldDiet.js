/**
 * Best of World Diet — global traditional food patterns for wellness tracking.
 * Evidence-supported nutrition tags only; no miracle health claims.
 */

const WORLD_DIET_MODES = [
  { value: 'world_diet', label: 'Best of World Diet', region: 'global', goalDefault: 'general_health' },
  { value: 'world_mediterranean', label: 'Mediterranean Inspired', region: 'mediterranean', goalDefault: 'general_health' },
  { value: 'world_middle_eastern', label: 'Middle Eastern Inspired', region: 'middle_eastern', goalDefault: 'general_health' },
  { value: 'world_south_asian', label: 'South Asian Inspired', region: 'south_asian', goalDefault: 'general_health' },
  { value: 'world_japanese', label: 'Japanese Inspired', region: 'japanese', goalDefault: 'general_health' },
  { value: 'world_korean', label: 'Korean Inspired', region: 'korean', goalDefault: 'general_health' },
  { value: 'world_nordic', label: 'Nordic Inspired', region: 'nordic', goalDefault: 'general_health' },
  { value: 'world_latin', label: 'Latin Inspired', region: 'latin', goalDefault: 'general_health' },
  { value: 'world_balanced_traditional', label: 'Balanced Traditional Diet', region: 'global', goalDefault: 'maintenance' },
]

const WORLD_PLATE_SLOTS = [
  { key: 'cultureStyle', label: 'Culture / style' },
  { key: 'protein', label: 'Protein' },
  { key: 'carb', label: 'Carb / whole grain' },
  { key: 'vegetables', label: 'Vegetables' },
  { key: 'healthyFat', label: 'Healthy fat' },
  { key: 'probiotic', label: 'Fermented / probiotic' },
  { key: 'nutsSeeds', label: 'Nuts / seeds' },
  { key: 'hydration', label: 'Drink / hydration' },
]

const FOOD_CATEGORY_FILTERS = [
  { value: 'fermented', label: 'Fermented / probiotic' },
  { value: 'high_protein', label: 'High protein' },
  { value: 'healthy_fats', label: 'Healthy fats' },
  { value: 'fiber', label: 'Fiber-rich' },
  { value: 'minerals', label: 'Mineral-rich' },
  { value: 'slow_carb', label: 'Slow carbs' },
  { value: 'herbs_spices', label: 'Herbs / spices' },
  { value: 'anti_inflammatory', label: 'Anti-inflammatory style' },
  { value: 'hydration', label: 'Hydration foods' },
]

const REGION_PLATE_CONFIG = {
  global: {
    label: 'Best of World',
    example: 'Mix proven staples from multiple regions — legumes, whole grains, vegetables, yogurt, nuts, and water.',
    slotKeywords: {
      cultureStyle: ['world', 'traditional'],
      protein: ['chicken', 'fish', 'salmon', 'eggs', 'lentils', 'chickpeas', 'tofu'],
      carb: ['brown rice', 'rice', 'oats', 'quinoa', 'millet'],
      vegetables: ['spinach', 'broccoli', 'cucumber', 'tomato', 'leafy'],
      healthyFat: ['olive oil', 'avocado', 'tahini', 'almonds'],
      probiotic: ['yogurt', 'kefir', 'kimchi', 'miso'],
      nutsSeeds: ['almonds', 'walnuts', 'sesame', 'pumpkin seeds'],
      hydration: ['water', 'green tea', 'laban', 'lassi'],
    },
  },
  mediterranean: {
    label: 'Mediterranean Inspired',
    example: 'Fish + brown rice + salad + olive oil + tahini + yogurt.',
    slotKeywords: {
      cultureStyle: ['mediterranean', 'olive'],
      protein: ['fish', 'salmon', 'chicken', 'eggs', 'lentils', 'chickpeas'],
      carb: ['brown rice', 'oats'],
      vegetables: ['cucumber', 'tomato', 'spinach', 'broccoli'],
      healthyFat: ['olive oil', 'tahini', 'olives', 'avocado'],
      probiotic: ['greek yogurt', 'kefir'],
      nutsSeeds: ['almonds', 'walnuts', 'sesame'],
      hydration: ['water'],
    },
  },
  middle_eastern: {
    label: 'Middle Eastern Inspired',
    example: 'Grilled chicken + lentil soup + cucumber/tomato + laban + dates + parsley.',
    slotKeywords: {
      cultureStyle: ['middle eastern', 'dates', 'laban'],
      protein: ['chicken', 'lentils', 'chickpeas', 'eggs'],
      carb: ['rice', 'brown rice'],
      vegetables: ['cucumber', 'tomato', 'parsley'],
      healthyFat: ['olive oil', 'tahini', 'hummus'],
      probiotic: ['laban', 'kefir', 'yogurt'],
      nutsSeeds: ['almonds', 'sesame', 'pistachios'],
      hydration: ['laban', 'water'],
    },
  },
  south_asian: {
    label: 'South Asian Inspired',
    example: 'Dal + rice + yogurt + cucumber + small desi ghee portion.',
    slotKeywords: {
      cultureStyle: ['south asian', 'dal', 'turmeric'],
      protein: ['dal', 'lentils', 'chickpeas', 'eggs', 'chicken'],
      carb: ['rice', 'brown rice'],
      vegetables: ['spinach', 'cucumber', 'tomato'],
      healthyFat: ['desi ghee', 'sesame'],
      probiotic: ['yogurt', 'lassi'],
      nutsSeeds: ['sesame', 'almonds'],
      hydration: ['lassi', 'water'],
    },
  },
  japanese: {
    label: 'Japanese Inspired',
    example: 'Fish + rice + miso soup + seaweed + green tea.',
    slotKeywords: {
      cultureStyle: ['japanese', 'miso'],
      protein: ['fish', 'salmon', 'tofu', 'eggs'],
      carb: ['rice', 'brown rice'],
      vegetables: ['seaweed', 'spinach', 'broccoli'],
      healthyFat: ['sesame', 'fish'],
      probiotic: ['miso', 'natto'],
      nutsSeeds: ['sesame', 'pumpkin seeds'],
      hydration: ['green tea', 'water'],
    },
  },
  korean: {
    label: 'Korean Inspired',
    example: 'Eggs/tofu + rice + kimchi + vegetables.',
    slotKeywords: {
      cultureStyle: ['korean', 'kimchi'],
      protein: ['eggs', 'tofu', 'chicken'],
      carb: ['rice', 'brown rice'],
      vegetables: ['spinach', 'broccoli', 'cucumber'],
      healthyFat: ['sesame', 'avocado'],
      probiotic: ['kimchi'],
      nutsSeeds: ['sesame', 'pumpkin seeds'],
      hydration: ['water', 'green tea'],
    },
  },
  nordic: {
    label: 'Nordic Inspired',
    example: 'Salmon + rye/oats + potatoes + berries + yogurt.',
    slotKeywords: {
      cultureStyle: ['nordic', 'rye', 'berries'],
      protein: ['salmon', 'fish', 'eggs', 'yogurt'],
      carb: ['oats', 'rye', 'potatoes'],
      vegetables: ['broccoli', 'spinach'],
      healthyFat: ['salmon', 'walnuts'],
      probiotic: ['yogurt', 'kefir'],
      nutsSeeds: ['walnuts', 'pumpkin seeds'],
      hydration: ['water'],
    },
  },
  latin: {
    label: 'Latin Inspired',
    example: 'Beans + avocado + eggs/fish + salsa + corn/quinoa.',
    slotKeywords: {
      cultureStyle: ['latin', 'salsa', 'quinoa'],
      protein: ['beans', 'black beans', 'chickpeas', 'eggs', 'fish', 'chicken'],
      carb: ['corn', 'quinoa', 'rice'],
      vegetables: ['tomato', 'avocado', 'spinach'],
      healthyFat: ['avocado', 'olive oil'],
      probiotic: ['yogurt'],
      nutsSeeds: ['peanuts', 'pumpkin seeds'],
      hydration: ['water'],
    },
  },
}

const CAUTION_GUIDANCE = {
  high_sodium: 'Can be high in sodium — check labels and portion size.',
  saturated_fat: 'Higher in saturated fat — use small portions for flavor.',
  calorie_dense: 'Calorie dense — measure portions for balance.',
  allergen_soy: 'Contains soy — avoid if allergic.',
  allergen_dairy: 'Contains dairy — avoid if allergic or intolerant.',
  allergen_nuts: 'Contains tree nuts or peanuts — avoid if allergic.',
  allergen_fish: 'Contains fish/seafood — avoid if allergic.',
  allergen_gluten: 'May contain gluten — check ingredients if sensitive.',
}

function isWorldDietMode(dietaryPreference) {
  const d = String(dietaryPreference || '')
  return d === 'world_diet' || d.startsWith('world_')
}

function worldDietModeConfig(dietaryPreference) {
  return WORLD_DIET_MODES.find((m) => m.value === dietaryPreference) || WORLD_DIET_MODES[0]
}

function resolveRegion(dietaryPreference) {
  const mode = worldDietModeConfig(dietaryPreference)
  return mode.region || 'global'
}

function foodMatchesRegion(food, region) {
  if (region === 'global') return true
  const origin = String(food.origin_region || '').toLowerCase()
  const dietTags = (food.diet_tags || []).join(' ').toLowerCase()
  const tags = (food.tags || []).join(' ').toLowerCase()
  return origin === region || origin === 'global' || dietTags.includes(region) || tags.includes(region)
}

function findLibraryMatches(library, keywords, limit = 1, region = 'global') {
  const out = []
  const pool = library.filter((f) => foodMatchesRegion(f, region))
  for (const kw of keywords) {
    const match = pool.find((f) => {
      const name = String(f.name).toLowerCase()
      const tagStr = [...(f.tags || []), ...(f.diet_tags || []), ...(f.nutrient_tags || [])].join(' ').toLowerCase()
      return name.includes(kw) || tagStr.includes(kw)
    })
    if (match && !out.some((o) => o.id === match.id)) {
      out.push({
        id: match.id,
        name: match.name,
        image_url: match.image_url,
        why_recommended: match.why_recommended,
        origin_region: match.origin_region,
        caution_tags: match.caution_tags || [],
        nutrients: match.nutrients,
      })
    }
    if (out.length >= limit) break
  }
  return out
}

function buildWorldPlate(library, profile = {}, selectedRegion = null) {
  const mode = worldDietModeConfig(profile.dietary_preference || profile.dietaryPreference)
  const region = selectedRegion || mode.region || 'global'
  const config = REGION_PLATE_CONFIG[region] || REGION_PLATE_CONFIG.global

  const plate = {
    mode: mode.label,
    region,
    regionLabel: config.label,
    slots: {},
    example: { title: `${config.label} plate`, description: config.example },
    disclaimer: 'Traditional food patterns for wellness planning — not medical advice or miracle cures.',
  }

  for (const slot of WORLD_PLATE_SLOTS) {
    const keywords = config.slotKeywords[slot.key] || []
    const matches = findLibraryMatches(library, keywords, 2, region)
    const suggestion = slot.key === 'cultureStyle'
      ? config.label
      : (matches[0]?.name || keywords[0] || slot.label)
    plate.slots[slot.key] = {
      label: slot.label,
      items: matches,
      suggestion,
    }
  }

  plate.summary = [
    plate.slots.protein?.suggestion,
    plate.slots.carb?.suggestion,
    plate.slots.vegetables?.suggestion,
    plate.slots.healthyFat?.suggestion,
    plate.slots.probiotic?.suggestion,
    plate.slots.nutsSeeds?.suggestion,
    plate.slots.hydration?.suggestion,
  ].filter(Boolean).join(' + ')

  return plate
}

function getWorldDietFoodSuggestions(library, limit = 12, region = 'global') {
  const scored = library.filter((f) => {
    const hasWorldTag = (f.diet_tags || []).includes('world_diet') || (f.tags || []).includes('world_diet')
    return hasWorldTag || foodMatchesRegion(f, region)
  })
  return scored.slice(0, limit).map((f) => ({
    id: f.id,
    name: f.name,
    image_url: f.image_url,
    origin_region: f.origin_region,
    why_recommended: f.why_recommended,
    caution_tags: f.caution_tags || [],
    nutrient_tags: f.nutrient_tags || [],
  }))
}

function worldDietNutrientSuggestions() {
  const base = require('./nutrientReferenceData').NUTRIENT_FOOD_SUGGESTIONS
  return {
    ...base,
    protein: ['chicken', 'fish', 'salmon', 'eggs', 'lentils', 'chickpeas', 'dal', 'tofu', 'Greek yogurt'],
    fiber: ['lentils', 'chickpeas', 'oats', 'quinoa', 'beans', 'vegetables', 'kimchi'],
    omega3: ['salmon', 'fish', 'walnuts', 'flax', 'seaweed'],
    probiotics: ['Greek yogurt', 'kefir', 'kimchi', 'miso', 'natto', 'laban'],
    magnesium: ['almonds', 'tahini', 'spinach', 'chickpeas', 'sesame seeds', 'pumpkin seeds'],
    calcium: ['Greek yogurt', 'feta cheese', 'tahini', 'sesame seeds', 'kefir'],
    iron: ['lentils', 'spinach', 'chickpeas', 'dal'],
    potassium: ['banana', 'potatoes', 'avocado', 'spinach', 'dates'],
  }
}

function buildFoodFilterOptions(library) {
  const regions = new Set()
  for (const f of library) {
    if (f.origin_region) regions.add(f.origin_region)
  }
  return {
    regions: [...regions].sort(),
    categories: FOOD_CATEGORY_FILTERS,
    dietModes: WORLD_DIET_MODES,
  }
}

function matchesLibraryFilters(food, filters = {}) {
  if (filters.origin_region && food.origin_region !== filters.origin_region) return false
  if (filters.diet_tag && !(food.diet_tags || []).includes(filters.diet_tag)) return false
  if (filters.nutrient_tag && !(food.nutrient_tags || []).includes(filters.nutrient_tag)) return false
  if (filters.high_protein === 'true' && !(food.nutrient_tags || []).includes('high_protein')) return false
  if (filters.probiotic === 'true' && !(food.nutrient_tags || []).includes('probiotic') && !(food.nutrient_tags || []).includes('fermented')) return false
  if (filters.healthy_fat === 'true' && !(food.nutrient_tags || []).includes('healthy_fats')) return false
  if (filters.budget_friendly === 'true' && !(food.diet_tags || []).includes('budget_friendly')) return false
  if (filters.vegetarian === 'true' && (food.diet_tags || []).includes('non_vegetarian')) return false
  if (filters.non_vegetarian === 'true' && !(food.diet_tags || []).includes('non_vegetarian') && !(food.nutrient_tags || []).includes('high_protein')) return false
  if (filters.diet_mode) {
    const region = resolveRegion(filters.diet_mode)
    if (!foodMatchesRegion(food, region)) return false
  }
  if (filters.nutrient_gap) {
    const suggestions = worldDietNutrientSuggestions()[filters.nutrient_gap] || []
    const name = String(food.name).toLowerCase()
    if (suggestions.length && !suggestions.some((s) => name.includes(String(s).toLowerCase()))) return false
  }
  return true
}

function formatCautionNotes(cautionTags = []) {
  return (cautionTags || [])
    .map((t) => CAUTION_GUIDANCE[t] || null)
    .filter(Boolean)
}

function extractKeyMicronutrients(nutrients = {}) {
  const keys = ['magnesium', 'calcium', 'iron', 'potassium', 'omega3', 'zinc', 'vitaminC', 'vitaminD', 'b12', 'folate']
  const out = []
  for (const key of keys) {
    const val = Number(nutrients[key] ?? nutrients[key === 'folate' ? 'b9' : key] ?? 0)
    if (val > 0) out.push({ key, value: val })
  }
  return out.slice(0, 6)
}

module.exports = {
  WORLD_DIET_MODES,
  WORLD_PLATE_SLOTS,
  FOOD_CATEGORY_FILTERS,
  REGION_PLATE_CONFIG,
  CAUTION_GUIDANCE,
  isWorldDietMode,
  worldDietModeConfig,
  resolveRegion,
  buildWorldPlate,
  getWorldDietFoodSuggestions,
  worldDietNutrientSuggestions,
  buildFoodFilterOptions,
  matchesLibraryFilters,
  formatCautionNotes,
  extractKeyMicronutrients,
  foodMatchesRegion,
}
