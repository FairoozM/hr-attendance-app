/**
 * Metadata backfill for existing seed foods (by exact name).
 * Applied on boot to global library rows.
 */

const FOOD_METADATA_BY_NAME = {
  'Eggs (whole, large)': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global', 'non_vegetarian'],
    nutrient_tags: ['high_protein', 'choline', 'creatine_source', 'b_vitamins'],
    why_recommended: 'Whole eggs provide complete protein, choline, and B vitamins used in many traditional diets.',
  },
  'Chicken breast (grilled)': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global', 'non_vegetarian', 'budget_friendly'],
    nutrient_tags: ['high_protein', 'low_fat'],
    why_recommended: 'Lean protein staple in Middle Eastern, Mediterranean, and global home cooking.',
  },
  'Salmon (baked)': {
    origin_region: 'nordic',
    diet_tags: ['world_diet', 'nordic', 'mediterranean', 'non_vegetarian'],
    nutrient_tags: ['high_protein', 'omega3', 'healthy_fats', 'vitamin_d'],
    caution_tags: ['allergen_fish'],
    why_recommended: 'Fatty fish rich in omega-3 EPA/DHA — Nordic and Japanese dietary staple.',
  },
  'White rice (cooked)': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global', 'budget_friendly'],
    nutrient_tags: ['slow_carb'],
    why_recommended: 'Staple carb across Asia, Latin America, and Middle East — pair with protein and vegetables.',
  },
  'Oats (cooked)': {
    origin_region: 'nordic',
    diet_tags: ['world_diet', 'nordic', 'global', 'budget_friendly', 'vegetarian'],
    nutrient_tags: ['slow_carb', 'fiber', 'magnesium', 'b_vitamins'],
    why_recommended: 'Nordic and global whole grain with soluble fiber for steady energy.',
  },
  'Banana': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global', 'vegetarian'],
    nutrient_tags: ['potassium', 'slow_carb', 'hydration'],
    why_recommended: 'Portable fruit with potassium — common pre/post workout carb in many cultures.',
  },
  'Spinach (raw)': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global', 'vegetarian', 'budget_friendly'],
    nutrient_tags: ['iron', 'magnesium', 'fiber', 'anti_inflammatory', 'minerals'],
    why_recommended: 'Leafy green with iron and magnesium — used in South Asian, Nordic, and global cooking.',
  },
  'Potatoes (boiled)': {
    origin_region: 'nordic',
    diet_tags: ['world_diet', 'nordic', 'global', 'vegetarian', 'budget_friendly'],
    nutrient_tags: ['potassium', 'slow_carb', 'fiber'],
    why_recommended: 'Traditional Nordic and global tuber with potassium and satisfying carbs.',
  },
  'Broccoli (steamed)': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global', 'vegetarian'],
    nutrient_tags: ['fiber', 'vitamin_c', 'anti_inflammatory'],
    why_recommended: 'Cruciferous vegetable with vitamin C and fiber — supports vegetable variety.',
  },
  'Lentils (cooked)': {
    origin_region: 'middle_eastern',
    diet_tags: ['world_diet', 'middle_eastern', 'south_asian', 'mediterranean', 'vegetarian', 'budget_friendly'],
    nutrient_tags: ['high_protein', 'fiber', 'iron', 'slow_carb', 'minerals'],
    why_recommended: 'Legume staple in Middle Eastern, South Asian, and Mediterranean diets — protein and iron.',
  },
  'Black beans (cooked)': {
    origin_region: 'latin',
    diet_tags: ['world_diet', 'latin', 'vegetarian', 'budget_friendly'],
    nutrient_tags: ['high_protein', 'fiber', 'slow_carb', 'iron'],
    why_recommended: 'Latin American legume with fiber and plant protein.',
  },
  'Greek yogurt (plain)': {
    origin_region: 'mediterranean',
    diet_tags: ['world_diet', 'mediterranean', 'global'],
    nutrient_tags: ['high_protein', 'probiotic', 'fermented', 'calcium'],
    caution_tags: ['allergen_dairy'],
    why_recommended: 'Strained yogurt with protein and calcium — Mediterranean and global probiotic food.',
  },
  'Kefir (plain)': {
    origin_region: 'middle_eastern',
    diet_tags: ['world_diet', 'middle_eastern', 'global'],
    nutrient_tags: ['probiotic', 'fermented', 'calcium'],
    caution_tags: ['allergen_dairy'],
    why_recommended: 'Fermented milk drink with diverse probiotic cultures.',
  },
  'Almonds': {
    origin_region: 'middle_eastern',
    diet_tags: ['world_diet', 'mediterranean', 'middle_eastern'],
    nutrient_tags: ['healthy_fats', 'magnesium', 'vitamin_e', 'high_protein'],
    caution_tags: ['calorie_dense', 'allergen_nuts'],
    why_recommended: 'Tree nut with magnesium and healthy fats — measure portions due to calorie density.',
  },
  'Walnuts': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global'],
    nutrient_tags: ['omega3', 'healthy_fats', 'antioxidant_rich'],
    caution_tags: ['calorie_dense', 'allergen_nuts'],
    why_recommended: 'Plant source of omega-3 ALA — small handful is a typical portion.',
  },
  'Cashews': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global'],
    nutrient_tags: ['healthy_fats', 'magnesium'],
    caution_tags: ['calorie_dense', 'allergen_nuts'],
    why_recommended: 'Nuts add magnesium and healthy fats — portion control recommended.',
  },
  'Pistachios': {
    origin_region: 'middle_eastern',
    diet_tags: ['world_diet', 'middle_eastern', 'mediterranean'],
    nutrient_tags: ['healthy_fats', 'high_protein', 'fiber'],
    caution_tags: ['calorie_dense', 'allergen_nuts'],
    why_recommended: 'Middle Eastern nut with protein and fiber — calorie dense.',
  },
  'Peanuts': {
    origin_region: 'african',
    diet_tags: ['world_diet', 'african', 'latin'],
    nutrient_tags: ['high_protein', 'healthy_fats'],
    caution_tags: ['calorie_dense', 'allergen_nuts'],
    why_recommended: 'Legume-nut with protein — common in African and Latin cuisines.',
  },
  'Mixed nuts': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global'],
    nutrient_tags: ['healthy_fats', 'magnesium'],
    caution_tags: ['calorie_dense', 'allergen_nuts'],
    why_recommended: 'Mixed nuts add healthy fats and minerals — keep portions small.',
  },
  'Raisins': {
    origin_region: 'middle_eastern',
    diet_tags: ['world_diet', 'middle_eastern', 'mediterranean'],
    nutrient_tags: ['slow_carb', 'potassium', 'iron'],
    caution_tags: ['calorie_dense'],
    why_recommended: 'Dried fruit with iron and potassium — energy-dense; use modest portions.',
  },
  'Dates (Medjool)': {
    origin_region: 'middle_eastern',
    diet_tags: ['world_diet', 'middle_eastern', 'uae'],
    nutrient_tags: ['potassium', 'slow_carb', 'fiber'],
    caution_tags: ['calorie_dense'],
    why_recommended: 'Traditional Middle Eastern fruit with potassium — natural sweetness in moderation.',
  },
  'Olive oil': {
    origin_region: 'mediterranean',
    diet_tags: ['world_diet', 'mediterranean', 'global'],
    nutrient_tags: ['healthy_fats', 'antioxidant_rich'],
    caution_tags: ['calorie_dense'],
    why_recommended: 'Primary Mediterranean unsaturated fat — drizzle rather than pour for calorie balance.',
  },
  'Avocado': {
    origin_region: 'latin',
    diet_tags: ['world_diet', 'latin', 'global'],
    nutrient_tags: ['healthy_fats', 'potassium', 'fiber'],
    caution_tags: ['calorie_dense'],
    why_recommended: 'Monounsaturated fats and fiber — Latin American staple fat source.',
  },
  'Water': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global'],
    nutrient_tags: ['hydration'],
    why_recommended: 'Essential hydration — base for all dietary patterns.',
  },
  'Pumpkin seeds': {
    origin_region: 'latin',
    diet_tags: ['world_diet', 'latin', 'global'],
    nutrient_tags: ['magnesium', 'healthy_fats', 'iron'],
    caution_tags: ['calorie_dense'],
    why_recommended: 'Seed topping with magnesium and zinc.',
  },
  'Tahini (sesame paste)': {
    origin_region: 'middle_eastern',
    diet_tags: ['world_diet', 'mediterranean', 'middle_eastern'],
    nutrient_tags: ['healthy_fats', 'magnesium', 'calcium'],
    caution_tags: ['calorie_dense'],
    why_recommended: 'Sesame paste with magnesium and calcium — healthy fat in measured portions.',
  },
  'Hummus': {
    origin_region: 'middle_eastern',
    diet_tags: ['world_diet', 'mediterranean', 'middle_eastern', 'vegetarian'],
    nutrient_tags: ['high_protein', 'healthy_fats', 'fiber', 'fermented'],
    why_recommended: 'Chickpea and tahini spread — protein, fiber, and healthy fats together.',
  },
  'Chickpeas (cooked)': {
    origin_region: 'mediterranean',
    diet_tags: ['world_diet', 'mediterranean', 'middle_eastern', 'south_asian', 'vegetarian', 'budget_friendly'],
    nutrient_tags: ['high_protein', 'fiber', 'iron', 'slow_carb'],
    why_recommended: 'Versatile legume across Mediterranean, Middle Eastern, and South Asian diets.',
  },
  'Olives (green)': {
    origin_region: 'mediterranean',
    diet_tags: ['world_diet', 'mediterranean'],
    nutrient_tags: ['healthy_fats', 'antioxidant_rich'],
    caution_tags: ['high_sodium', 'calorie_dense'],
    why_recommended: 'Mediterranean fat source — watch sodium in brined olives.',
  },
  'Feta cheese': {
    origin_region: 'mediterranean',
    diet_tags: ['world_diet', 'mediterranean'],
    nutrient_tags: ['high_protein', 'calcium'],
    caution_tags: ['allergen_dairy', 'high_sodium', 'saturated_fat'],
    why_recommended: 'Calcium and protein from traditional Mediterranean dairy — moderate portions.',
  },
  'Sesame seeds': {
    origin_region: 'middle_eastern',
    diet_tags: ['world_diet', 'middle_eastern', 'south_asian', 'japanese'],
    nutrient_tags: ['healthy_fats', 'magnesium', 'calcium'],
    caution_tags: ['calorie_dense'],
    why_recommended: 'Sesame nutrients including magnesium and calcium.',
  },
  'Desi ghee (clarified butter)': {
    origin_region: 'south_asian',
    diet_tags: ['world_diet', 'south_asian'],
    nutrient_tags: ['saturated_fat'],
    caution_tags: ['saturated_fat', 'calorie_dense'],
    why_recommended: 'Optional South Asian cooking fat — small amounts for flavor; higher in saturated fat.',
  },
  'Brown rice (cooked)': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global', 'mediterranean', 'budget_friendly', 'vegetarian'],
    nutrient_tags: ['slow_carb', 'fiber', 'magnesium'],
    why_recommended: 'Whole-grain rice with more fiber than white rice — global staple carb.',
  },
  'Cucumber': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global', 'vegetarian', 'budget_friendly'],
    nutrient_tags: ['hydration', 'fiber', 'low_glycemic'],
    why_recommended: 'Hydrating low-calorie vegetable — common in Middle Eastern and global salads.',
  },
  'Tomatoes': {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global', 'mediterranean', 'latin', 'vegetarian', 'budget_friendly'],
    nutrient_tags: ['vitamin_c', 'antioxidant_rich', 'hydration'],
    why_recommended: 'Vitamin C and lycopene from a globally used vegetable.',
  },
  Apple: {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global', 'vegetarian', 'budget_friendly'],
    nutrient_tags: ['fiber', 'vitamin_c', 'slow_carb'],
    why_recommended: 'Common fruit with fiber and vitamin C.',
  },
  Granola: {
    origin_region: 'global',
    diet_tags: ['world_diet', 'global', 'vegetarian'],
    nutrient_tags: ['slow_carb', 'fiber', 'magnesium'],
    caution_tags: ['calorie_dense'],
    why_recommended: 'Fiber-rich breakfast mix — portion control recommended.',
  },
  'Bitter gourd (karela)': {
    origin_region: 'south_asian',
    diet_tags: ['world_diet', 'south_asian', 'vegetarian', 'budget_friendly'],
    nutrient_tags: ['fiber', 'vitamin_c', 'low_glycemic'],
    why_recommended: 'Low-calorie South Asian vegetable with fiber and vitamin C.',
  },
}

function mergeFoodMetadata(food) {
  const meta = FOOD_METADATA_BY_NAME[food.name] || {}
  return {
    ...food,
    origin_region: food.origin_region || meta.origin_region || 'global',
    diet_tags: food.diet_tags || meta.diet_tags || ['world_diet'],
    nutrient_tags: food.nutrient_tags || meta.nutrient_tags || [],
    caution_tags: food.caution_tags || meta.caution_tags || [],
    why_recommended: food.why_recommended || meta.why_recommended || null,
  }
}

module.exports = { FOOD_METADATA_BY_NAME, mergeFoodMetadata }
