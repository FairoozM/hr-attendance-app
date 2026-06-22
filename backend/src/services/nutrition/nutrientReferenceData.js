/**
 * Configurable evidence-based nutrition reference data.
 * Sources: NIH ODS fact sheets, WHO healthy diet principles, general adult DRI-style guidance.
 * Admin-editable via nutrient_targets table; these are bootstrap defaults.
 */

const WELLNESS_DISCLAIMER =
  'For wellness tracking only. Not medical advice. Consult a doctor/dietitian if you have medical conditions, kidney issues, heart issues, diabetes, pregnancy, eating disorder history, or take medication.'

const FITNESS_SAFETY_NOTES = [
  'Stop immediately if you feel sharp pain, chest pain, dizziness, or breathing difficulty.',
  'Increase weights gradually and prioritize proper form.',
  'Include rest days — avoid training the same muscle group hard every day.',
  'Warm up before lifting and cool down with light stretching afterward.',
  'Stay hydrated and aim for adequate sleep for recovery.',
]

/** Nutrient keys used across food logs, library, and coverage engine */
const NUTRIENT_KEYS = [
  'calories',
  'protein',
  'carbs',
  'fiber',
  'fat',
  'saturatedFat',
  'omega3',
  'cholesterol',
  'potassium',
  'magnesium',
  'calcium',
  'zinc',
  'iron',
  'sodium',
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'vitaminK',
  'b1',
  'b2',
  'b3',
  'b5',
  'b6',
  'b7',
  'b9',
  'b12',
  'choline',
  'creatine',
  'probiotics',
  'waterMl',
]

/** Card groupings for dashboard display */
const COVERAGE_CARD_GROUPS = [
  { key: 'protein', label: 'Protein', nutrients: ['protein'] },
  { key: 'carbs', label: 'Carbs', nutrients: ['carbs'] },
  { key: 'fiber', label: 'Fiber', nutrients: ['fiber'] },
  { key: 'goodFats', label: 'Good fats', nutrients: ['omega3', 'fat'] },
  { key: 'potassium', label: 'Potassium', nutrients: ['potassium'] },
  { key: 'magnesium', label: 'Magnesium', nutrients: ['magnesium'] },
  { key: 'bVitamins', label: 'B vitamins', nutrients: ['b1', 'b2', 'b3', 'b5', 'b6', 'b7', 'b9', 'b12'] },
  { key: 'choline', label: 'Choline', nutrients: ['choline'] },
  { key: 'creatine', label: 'Creatine', nutrients: ['creatine'] },
  { key: 'probiotics', label: 'Probiotics', nutrients: ['probiotics'] },
  { key: 'vitamins', label: 'Vitamins', nutrients: ['vitaminA', 'vitaminC', 'vitaminD', 'vitaminE', 'vitaminK'] },
  { key: 'minerals', label: 'Minerals', nutrients: ['calcium', 'zinc', 'iron'] },
  { key: 'hydration', label: 'Hydration', nutrients: ['waterMl'] },
]

/** Default adult targets — admin can override in nutrient_targets table */
const DEFAULT_NUTRIENT_TARGETS = [
  { nutrient_key: 'calories', display_name: 'Calories', category: 'energy', unit: 'kcal', default_target: 2200, min_target: 1600, max_target: 3200, reference_source: 'WHO healthy diet — general adult energy guidance', reference_url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet' },
  { nutrient_key: 'protein', display_name: 'Protein', category: 'macro', unit: 'g', default_target: 90, min_target: 50, max_target: 200, reference_source: 'General adult protein guidance', reference_url: 'https://ods.od.nih.gov/factsheets/Protein-HealthProfessional/' },
  { nutrient_key: 'carbs', display_name: 'Carbohydrates', category: 'macro', unit: 'g', default_target: 275, min_target: 130, max_target: 400, reference_source: 'WHO healthy diet — whole grains emphasis', reference_url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet' },
  { nutrient_key: 'fiber', display_name: 'Fiber', category: 'macro', unit: 'g', default_target: 30, min_target: 25, max_target: 50, reference_source: 'WHO healthy diet — dietary fiber', reference_url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet' },
  { nutrient_key: 'fat', display_name: 'Total fat', category: 'macro', unit: 'g', default_target: 70, min_target: 44, max_target: 100, reference_source: 'WHO healthy diet — unsaturated fat emphasis', reference_url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet' },
  { nutrient_key: 'saturatedFat', display_name: 'Saturated fat', category: 'macro', unit: 'g', default_target: 20, min_target: null, max_target: 22, reference_source: 'WHO healthy diet — limit saturated fat', reference_url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet' },
  { nutrient_key: 'omega3', display_name: 'Omega-3 / healthy fats', category: 'macro', unit: 'g', default_target: 1.6, min_target: 1.1, max_target: 3, reference_source: 'NIH ODS — omega-3 fatty acids', reference_url: 'https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/' },
  { nutrient_key: 'potassium', display_name: 'Potassium', category: 'mineral', unit: 'mg', default_target: 3400, min_target: 2600, max_target: 4700, reference_source: 'NIH ODS — potassium', reference_url: 'https://ods.od.nih.gov/factsheets/Potassium-HealthProfessional/' },
  { nutrient_key: 'magnesium', display_name: 'Magnesium', category: 'mineral', unit: 'mg', default_target: 420, min_target: 320, max_target: 500, reference_source: 'NIH ODS — magnesium', reference_url: 'https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/' },
  { nutrient_key: 'calcium', display_name: 'Calcium', category: 'mineral', unit: 'mg', default_target: 1000, min_target: 800, max_target: 2500, reference_source: 'NIH ODS — calcium', reference_url: 'https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/' },
  { nutrient_key: 'zinc', display_name: 'Zinc', category: 'mineral', unit: 'mg', default_target: 11, min_target: 8, max_target: 40, reference_source: 'NIH ODS — zinc', reference_url: 'https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/' },
  { nutrient_key: 'iron', display_name: 'Iron', category: 'mineral', unit: 'mg', default_target: 8, min_target: 8, max_target: 45, reference_source: 'NIH ODS — iron', reference_url: 'https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/' },
  { nutrient_key: 'sodium', display_name: 'Sodium', category: 'mineral', unit: 'mg', default_target: 2300, min_target: null, max_target: 2300, reference_source: 'WHO healthy diet — limit sodium', reference_url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet' },
  { nutrient_key: 'vitaminA', display_name: 'Vitamin A', category: 'vitamin', unit: 'mcg', default_target: 900, min_target: 700, max_target: 3000, reference_source: 'NIH ODS — vitamin A', reference_url: 'https://ods.od.nih.gov/factsheets/VitaminA-HealthProfessional/' },
  { nutrient_key: 'vitaminC', display_name: 'Vitamin C', category: 'vitamin', unit: 'mg', default_target: 90, min_target: 75, max_target: 2000, reference_source: 'NIH ODS — vitamin C', reference_url: 'https://ods.od.nih.gov/factsheets/VitaminC-HealthProfessional/' },
  { nutrient_key: 'vitaminD', display_name: 'Vitamin D', category: 'vitamin', unit: 'mcg', default_target: 15, min_target: 15, max_target: 100, reference_source: 'NIH ODS — vitamin D', reference_url: 'https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/' },
  { nutrient_key: 'vitaminE', display_name: 'Vitamin E', category: 'vitamin', unit: 'mg', default_target: 15, min_target: 12, max_target: 1000, reference_source: 'NIH ODS — vitamin E', reference_url: 'https://ods.od.nih.gov/factsheets/VitaminE-HealthProfessional/' },
  { nutrient_key: 'vitaminK', display_name: 'Vitamin K', category: 'vitamin', unit: 'mcg', default_target: 120, min_target: 90, max_target: null, reference_source: 'NIH ODS — vitamin K', reference_url: 'https://ods.od.nih.gov/factsheets/VitaminK-HealthProfessional/' },
  { nutrient_key: 'b1', display_name: 'Thiamin (B1)', category: 'vitamin', unit: 'mg', default_target: 1.2, min_target: 1.0, max_target: null, reference_source: 'NIH ODS — thiamin', reference_url: 'https://ods.od.nih.gov/factsheets/Thiamin-HealthProfessional/' },
  { nutrient_key: 'b2', display_name: 'Riboflavin (B2)', category: 'vitamin', unit: 'mg', default_target: 1.3, min_target: 1.0, max_target: null, reference_source: 'NIH ODS — riboflavin', reference_url: 'https://ods.od.nih.gov/factsheets/Riboflavin-HealthProfessional/' },
  { nutrient_key: 'b3', display_name: 'Niacin (B3)', category: 'vitamin', unit: 'mg', default_target: 16, min_target: 12, max_target: 35, reference_source: 'NIH ODS — niacin', reference_url: 'https://ods.od.nih.gov/factsheets/Niacin-HealthProfessional/' },
  { nutrient_key: 'b5', display_name: 'Pantothenic acid (B5)', category: 'vitamin', unit: 'mg', default_target: 5, min_target: 4, max_target: null, reference_source: 'NIH ODS — pantothenic acid', reference_url: 'https://ods.od.nih.gov/factsheets/PantothenicAcid-HealthProfessional/' },
  { nutrient_key: 'b6', display_name: 'Vitamin B6', category: 'vitamin', unit: 'mg', default_target: 1.3, min_target: 1.0, max_target: 100, reference_source: 'NIH ODS — vitamin B6', reference_url: 'https://ods.od.nih.gov/factsheets/VitaminB6-HealthProfessional/' },
  { nutrient_key: 'b7', display_name: 'Biotin (B7)', category: 'vitamin', unit: 'mcg', default_target: 30, min_target: 25, max_target: null, reference_source: 'NIH ODS — biotin', reference_url: 'https://ods.od.nih.gov/factsheets/Biotin-HealthProfessional/' },
  { nutrient_key: 'b9', display_name: 'Folate (B9)', category: 'vitamin', unit: 'mcg', default_target: 400, min_target: 320, max_target: 1000, reference_source: 'NIH ODS — folate', reference_url: 'https://ods.od.nih.gov/factsheets/Folate-HealthProfessional/' },
  { nutrient_key: 'b12', display_name: 'Vitamin B12', category: 'vitamin', unit: 'mcg', default_target: 2.4, min_target: 2.0, max_target: null, reference_source: 'NIH ODS — vitamin B12', reference_url: 'https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/' },
  { nutrient_key: 'choline', display_name: 'Choline', category: 'other', unit: 'mg', default_target: 550, min_target: 425, max_target: 3500, reference_source: 'NIH ODS — choline', reference_url: 'https://ods.od.nih.gov/factsheets/Choline-HealthProfessional/' },
  { nutrient_key: 'creatine', display_name: 'Creatine (dietary)', category: 'other', unit: 'g', default_target: 2, min_target: 1, max_target: 5, reference_source: 'General dietary creatine from animal foods; supplement optional', reference_url: 'https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/' },
  { nutrient_key: 'probiotics', display_name: 'Probiotics (servings)', category: 'other', unit: 'servings', default_target: 1, min_target: 1, max_target: 3, reference_source: 'Fermented food servings — general wellness guidance', reference_url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet' },
  { nutrient_key: 'waterMl', display_name: 'Water', category: 'hydration', unit: 'ml', default_target: 2500, min_target: 2000, max_target: 4000, reference_source: 'General hydration guidance for active adults', reference_url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet' },
  { nutrient_key: 'cholesterol', display_name: 'Cholesterol', category: 'macro', unit: 'mg', default_target: 300, min_target: null, max_target: 300, reference_source: 'General dietary cholesterol guidance', reference_url: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet' },
]

/** Food suggestions keyed by nutrient gap — configurable, not medical claims */
const NUTRIENT_FOOD_SUGGESTIONS = {
  potassium: ['banana', 'potatoes', 'spinach', 'beans', 'dates', 'lentils'],
  magnesium: ['almonds', 'cashews', 'pumpkin seeds', 'spinach', 'black beans'],
  omega3: ['salmon', 'sardines', 'walnuts', 'chia seeds', 'flaxseed'],
  fat: ['olive oil', 'tahini', 'avocado', 'almonds', 'walnuts', 'olives', 'hummus'],
  probiotics: ['yogurt', 'kefir', 'kimchi', 'sauerkraut', 'miso'],
  choline: ['eggs', 'chicken', 'fish', 'beef liver', 'soybeans'],
  protein: ['eggs', 'chicken', 'fish', 'Greek yogurt', 'lentils', 'beans'],
  creatine: ['beef', 'salmon', 'chicken', 'pork', 'supplement note (optional)'],
  fiber: ['oats (cooked)', 'banana', 'broccoli (steamed)', 'lentils (cooked)', 'brown rice (cooked)', 'spinach (raw)'],
  iron: ['lentils', 'spinach', 'beef', 'chickpeas', 'fortified cereals'],
  calcium: ['Greek yogurt', 'feta cheese', 'tahini', 'sesame seeds', 'almonds'],
  vitaminC: ['oranges', 'bell peppers', 'broccoli', 'strawberries', 'kiwi'],
  vitaminD: ['salmon', 'egg yolks', 'fortified milk', 'sun exposure note'],
  b12: ['fish', 'meat', 'eggs', 'dairy', 'fortified nutritional yeast'],
  waterMl: ['water', 'herbal tea', 'cucumber', 'watermelon', 'broth'],
}

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'pre-workout', 'post-workout']

const ACTIVITY_LEVELS = [
  { value: 'sedentary', label: 'Sedentary', multiplier: 1.2 },
  { value: 'light', label: 'Lightly active', multiplier: 1.375 },
  { value: 'moderate', label: 'Moderately active', multiplier: 1.55 },
  { value: 'active', label: 'Very active', multiplier: 1.725 },
  { value: 'extra', label: 'Extra active', multiplier: 1.9 },
]

const GOALS = [
  { value: 'fat_loss', label: 'Fat loss' },
  { value: 'muscle_gain', label: 'Muscle gain' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'strength', label: 'Strength' },
  { value: 'general_health', label: 'General health' },
]

const DIETARY_PREFERENCES = [
  { value: 'normal', label: 'Normal / balanced' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'high_protein', label: 'High protein' },
  { value: 'low_carb', label: 'Low carb' },
  { value: 'mediterranean', label: 'Mediterranean Diet' },
  { value: 'mediterranean_high_protein', label: 'High Protein Mediterranean' },
  { value: 'mediterranean_fat_loss', label: 'Weight Loss Mediterranean' },
  { value: 'mediterranean_muscle_gain', label: 'Muscle Gain Mediterranean' },
  { value: 'world_diet', label: 'Best of World Diet' },
  { value: 'world_mediterranean', label: 'Mediterranean Inspired' },
  { value: 'world_middle_eastern', label: 'Middle Eastern Inspired' },
  { value: 'world_south_asian', label: 'South Asian Inspired' },
  { value: 'world_japanese', label: 'Japanese Inspired' },
  { value: 'world_korean', label: 'Korean Inspired' },
  { value: 'world_nordic', label: 'Nordic Inspired' },
  { value: 'world_latin', label: 'Latin Inspired' },
  { value: 'world_balanced_traditional', label: 'Balanced Traditional Diet' },
  { value: 'halal', label: 'Halal-friendly' },
]

module.exports = {
  WELLNESS_DISCLAIMER,
  FITNESS_SAFETY_NOTES,
  NUTRIENT_KEYS,
  COVERAGE_CARD_GROUPS,
  DEFAULT_NUTRIENT_TARGETS,
  NUTRIENT_FOOD_SUGGESTIONS,
  MEAL_TYPES,
  ACTIVITY_LEVELS,
  GOALS,
  DIETARY_PREFERENCES,
}
