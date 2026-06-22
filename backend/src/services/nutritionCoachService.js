const { query } = require('../db')
const {
  computeDailySummary,
  scaleNutrients,
  emptyNutrients,
} = require('./nutrition/nutrientCalculation')
const {
  DEFAULT_NUTRIENT_TARGETS,
  WELLNESS_DISCLAIMER,
  FITNESS_SAFETY_NOTES,
  MEAL_TYPES,
  NUTRIENT_FOOD_SUGGESTIONS,
} = require('./nutrition/nutrientReferenceData')
const { SEED_FOODS } = require('./nutrition/foodLibrarySeed')
const { WORLD_SEED_FOODS } = require('./nutrition/worldFoodSeed')
const { mergeFoodMetadata } = require('./nutrition/foodMetadata')
const { imageUrlForFoodName } = require('./nutrition/foodImages')
const { findLibraryFoodByName } = require('./nutrition/foodMatching')
const { computeAllCalculators } = require('./nutrition/healthCalculators')
const {
  isMediterraneanMode,
  buildMediterraneanPlate,
  getMediterraneanFoodSuggestions,
  analyzeFatIntake,
  MEDITERRANEAN_DIET_MODES,
  mediterraneanNutrientSuggestions,
} = require('./nutrition/mediterraneanDiet')
const {
  isWorldDietMode,
  buildWorldPlate,
  getWorldDietFoodSuggestions,
  worldDietNutrientSuggestions,
  buildFoodFilterOptions,
  matchesLibraryFilters,
  formatCautionNotes,
  extractKeyMicronutrients,
  WORLD_DIET_MODES,
  FOOD_CATEGORY_FILTERS,
} = require('./nutrition/worldDiet')

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function parseJson(val, fallback) {
  if (val == null) return fallback
  if (typeof val === 'object') return val
  try {
    return JSON.parse(val)
  } catch {
    return fallback
  }
}

async function ensureNutritionCoachTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS nutrition_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      age INTEGER,
      gender VARCHAR(20),
      height_cm NUMERIC(6,2),
      weight_kg NUMERIC(6,2),
      target_weight_kg NUMERIC(6,2),
      activity_level VARCHAR(30),
      goal VARCHAR(30),
      dietary_preference VARCHAR(40),
      allergies TEXT,
      disliked_foods TEXT,
      medical_caution_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS food_library (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      serving_unit VARCHAR(40) NOT NULL DEFAULT 'g',
      serving_size NUMERIC(10,2) NOT NULL DEFAULT 100,
      nutrients JSONB NOT NULL DEFAULT '{}'::jsonb,
      tags TEXT[] NOT NULL DEFAULT '{}',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_food_library_user ON food_library(user_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_food_library_name ON food_library(LOWER(name))`)
  await query(`
    CREATE TABLE IF NOT EXISTS food_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      log_date DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, log_date)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, log_date DESC)`)
  await query(`
    CREATE TABLE IF NOT EXISTS food_log_items (
      id SERIAL PRIMARY KEY,
      food_log_id INTEGER NOT NULL REFERENCES food_logs(id) ON DELETE CASCADE,
      meal_type VARCHAR(30) NOT NULL,
      food_name TEXT NOT NULL,
      food_library_id INTEGER REFERENCES food_library(id) ON DELETE SET NULL,
      quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      unit VARCHAR(40),
      nutrients JSONB NOT NULL DEFAULT '{}'::jsonb,
      why_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_food_log_items_log ON food_log_items(food_log_id)`)
  await query(`
    CREATE TABLE IF NOT EXISTS nutrient_targets (
      id SERIAL PRIMARY KEY,
      nutrient_key VARCHAR(50) NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      category VARCHAR(40) NOT NULL DEFAULT 'general',
      unit VARCHAR(20) NOT NULL DEFAULT 'mg',
      default_target NUMERIC(12,4),
      min_target NUMERIC(12,4),
      max_target NUMERIC(12,4),
      reference_source TEXT,
      reference_url TEXT,
      goal_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS nutrient_daily_summary (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      summary_date DATE NOT NULL,
      totals JSONB NOT NULL DEFAULT '{}'::jsonb,
      targets JSONB NOT NULL DEFAULT '{}'::jsonb,
      coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
      missing_nutrients JSONB NOT NULL DEFAULT '[]'::jsonb,
      food_quality_score NUMERIC(5,2),
      hydration_ml NUMERIC(10,2),
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, summary_date)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_nutrient_daily_summary_user ON nutrient_daily_summary(user_id, summary_date DESC)`)
  await query(`
    CREATE TABLE IF NOT EXISTS meal_plans (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_date DATE NOT NULL,
      title TEXT,
      plan_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      calorie_target NUMERIC(10,2),
      protein_target NUMERIC(10,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS workout_plans (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      level VARCHAR(20) NOT NULL DEFAULT 'beginner',
      weekly_schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
      safety_notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS workout_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workout_plan_id INTEGER REFERENCES workout_plans(id) ON DELETE SET NULL,
      session_date DATE NOT NULL,
      session_type VARCHAR(40),
      completed BOOLEAN NOT NULL DEFAULT false,
      duration_minutes INTEGER,
      notes TEXT,
      body JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS workout_exercises (
      id SERIAL PRIMARY KEY,
      workout_session_id INTEGER NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
      muscle_group VARCHAR(40),
      exercise_name TEXT NOT NULL,
      sets INTEGER,
      reps VARCHAR(20),
      weight_kg NUMERIC(8,2),
      rpe NUMERIC(3,1),
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS progress_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      log_date DATE NOT NULL,
      weight_kg NUMERIC(6,2),
      body_fat_pct NUMERIC(5,2),
      notes TEXT,
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await ensureNutritionCoachExtendedColumns()
  await seedNutrientTargets()
  await seedFoodLibrary()
}

async function ensureNutritionCoachExtendedColumns() {
  const cols = [
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS display_name TEXT`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS waist_cm NUMERIC(6,2)`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS job_activity_level VARCHAR(30)`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS sleep_hours NUMERIC(4,1)`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS usual_meal_timing JSONB NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS gym_experience VARCHAR(30)`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS available_gym_days JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS workout_goal VARCHAR(30)`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS injuries_pain_areas TEXT`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS medical_caution_notes TEXT`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS supplement_usage TEXT`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS daily_water_baseline_ml NUMERIC(10,2)`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS caffeine_intake VARCHAR(40)`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS digestion_probiotic_habits TEXT`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS budget_level VARCHAR(30)`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS preferred_foods TEXT`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS onboarding_step SMALLINT NOT NULL DEFAULT 0`,
    `ALTER TABLE food_library ADD COLUMN IF NOT EXISTS image_url TEXT`,
    `ALTER TABLE food_library ADD COLUMN IF NOT EXISTS image_key TEXT`,
    `ALTER TABLE food_library ADD COLUMN IF NOT EXISTS origin_region TEXT`,
    `ALTER TABLE food_library ADD COLUMN IF NOT EXISTS diet_tags TEXT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE food_library ADD COLUMN IF NOT EXISTS nutrient_tags TEXT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE food_library ADD COLUMN IF NOT EXISTS caution_tags TEXT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE food_library ADD COLUMN IF NOT EXISTS why_recommended TEXT`,
  ]
  for (const sql of cols) await query(sql)
  await query(`CREATE INDEX IF NOT EXISTS idx_food_library_origin_region ON food_library(origin_region)`)
  await backfillFoodLibraryImages()
  await backfillFoodLibraryMetadata()
}

function formatFoodLibraryRow(r) {
  const nutrients = parseJson(r.nutrients, {})
  const cautionNotes = formatCautionNotes(r.caution_tags || [])
  return {
    ...r,
    nutrients,
    tags: r.tags || [],
    diet_tags: r.diet_tags || [],
    nutrient_tags: r.nutrient_tags || [],
    caution_tags: r.caution_tags || [],
    image_url: r.image_url || imageUrlForFoodName(r.name),
    calories_per_serving: nutrients.calories ?? null,
    protein: nutrients.protein ?? null,
    carbs: nutrients.carbs ?? null,
    fats: nutrients.fat ?? null,
    fiber: nutrients.fiber ?? null,
    key_micronutrients: extractKeyMicronutrients(nutrients),
    caution_notes: cautionNotes,
  }
}

async function backfillFoodLibraryMetadata() {
  const allFoods = [...SEED_FOODS, ...WORLD_SEED_FOODS].map(mergeFoodMetadata)
  for (const food of allFoods) {
    const imageUrl = food.image_url || imageUrlForFoodName(food.name)
    await query(
      `UPDATE food_library SET
        origin_region = COALESCE($2, origin_region),
        diet_tags = $3,
        nutrient_tags = $4,
        caution_tags = $5,
        why_recommended = COALESCE($6, why_recommended),
        tags = $7,
        image_url = COALESCE(image_url, $8)
       WHERE user_id IS NULL AND LOWER(name) = LOWER($1)`,
      [
        food.name,
        food.origin_region || 'global',
        food.diet_tags || ['world_diet'],
        food.nutrient_tags || [],
        food.caution_tags || [],
        food.why_recommended || null,
        food.tags || [],
        imageUrl,
      ],
    )
  }
}

async function backfillFoodLibraryImages() {
  const { rows } = await query(`SELECT id, name FROM food_library WHERE user_id IS NULL`)
  for (const row of rows) {
    const url = imageUrlForFoodName(row.name)
    if (!url) continue
    const key = String(row.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)
    await query(`UPDATE food_library SET image_url = $2, image_key = $3 WHERE id = $1`, [row.id, url, key])
  }
}

async function seedNutrientTargets() {
  for (const row of DEFAULT_NUTRIENT_TARGETS) {
    await query(
      `INSERT INTO nutrient_targets (
        nutrient_key, display_name, category, unit, default_target, min_target, max_target,
        reference_source, reference_url, goal_overrides, is_active, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,NOW())
      ON CONFLICT (nutrient_key) DO NOTHING`,
      [
        row.nutrient_key,
        row.display_name,
        row.category,
        row.unit,
        row.default_target,
        row.min_target,
        row.max_target,
        row.reference_source,
        row.reference_url,
        JSON.stringify(row.goal_overrides || {}),
      ],
    )
  }
}

async function seedFoodLibrary() {
  const allFoods = [...SEED_FOODS, ...WORLD_SEED_FOODS].map(mergeFoodMetadata)
  for (const food of allFoods) {
    const exists = await query(
      `SELECT id FROM food_library WHERE user_id IS NULL AND LOWER(name) = LOWER($1) LIMIT 1`,
      [food.name],
    )
    const imageUrl = food.image_url || imageUrlForFoodName(food.name)
    const imageKey = food.image_key || String(food.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)
    if (exists.rows.length > 0) continue
    await query(
      `INSERT INTO food_library (
        user_id, name, serving_unit, serving_size, nutrients, tags, image_url, image_key,
        origin_region, diet_tags, nutrient_tags, caution_tags, why_recommended
      ) VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        food.name,
        food.serving_unit,
        food.serving_size,
        JSON.stringify(food.nutrients),
        food.tags || [],
        imageUrl,
        imageKey,
        food.origin_region || 'global',
        food.diet_tags || ['world_diet'],
        food.nutrient_tags || [],
        food.caution_tags || [],
        food.why_recommended || null,
      ],
    )
  }
  await backfillFoodLibraryImages()
  await backfillFoodLibraryMetadata()
}

async function getNutrientTargets() {
  const { rows } = await query(`SELECT * FROM nutrient_targets WHERE is_active = true ORDER BY category, nutrient_key`)
  return rows
}

async function updateNutrientTarget(nutrientKey, patch) {
  const fields = []
  const params = []
  let i = 1
  const allowed = ['display_name', 'default_target', 'min_target', 'max_target', 'reference_source', 'reference_url', 'goal_overrides', 'is_active']
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = $${i++}`)
      params.push(key === 'goal_overrides' ? JSON.stringify(patch[key]) : patch[key])
    }
  }
  if (fields.length === 0) return null
  fields.push(`updated_at = NOW()`)
  params.push(nutrientKey)
  const { rows } = await query(
    `UPDATE nutrient_targets SET ${fields.join(', ')} WHERE nutrient_key = $${i} RETURNING *`,
    params,
  )
  return rows[0] || null
}

async function getProfile(userId) {
  const { rows } = await query(`SELECT * FROM nutrition_profiles WHERE user_id = $1`, [userId])
  return rows[0] || null
}

async function upsertProfile(userId, body) {
  const existing = await getProfile(userId)
  const fields = {
    display_name: body.display_name ?? body.displayName ?? body.name,
    age: body.age,
    gender: body.gender,
    height_cm: body.height_cm ?? body.heightCm,
    weight_kg: body.weight_kg ?? body.weightKg,
    target_weight_kg: body.target_weight_kg ?? body.targetWeightKg,
    waist_cm: body.waist_cm ?? body.waistCm,
    activity_level: body.activity_level ?? body.activityLevel,
    job_activity_level: body.job_activity_level ?? body.jobActivityLevel,
    sleep_hours: body.sleep_hours ?? body.sleepHours,
    goal: body.goal ?? body.workout_goal ?? body.workoutGoal,
    workout_goal: body.workout_goal ?? body.workoutGoal ?? body.goal,
    dietary_preference: body.dietary_preference ?? body.dietaryPreference ?? body.foodPreference,
    allergies: body.allergies,
    disliked_foods: body.disliked_foods ?? body.dislikedFoods,
    usual_meal_timing: body.usual_meal_timing ?? body.usualMealTiming ?? {},
    gym_experience: body.gym_experience ?? body.gymExperience,
    available_gym_days: body.available_gym_days ?? body.availableGymDays ?? [],
    injuries_pain_areas: body.injuries_pain_areas ?? body.injuriesPainAreas,
    medical_caution_flags: body.medical_caution_flags ?? body.medicalCautionFlags ?? {},
    medical_caution_notes: body.medical_caution_notes ?? body.medicalCautionNotes,
    supplement_usage: body.supplement_usage ?? body.supplementUsage,
    daily_water_baseline_ml: body.daily_water_baseline_ml ?? body.dailyWaterBaselineMl ?? body.waterIntake,
    caffeine_intake: body.caffeine_intake ?? body.caffeineIntake,
    digestion_probiotic_habits: body.digestion_probiotic_habits ?? body.digestionProbioticHabits,
    budget_level: body.budget_level ?? body.budgetLevel,
    preferred_foods: body.preferred_foods ?? body.preferredFoods,
    onboarding_completed: body.onboarding_completed ?? body.onboardingCompleted,
    onboarding_step: body.onboarding_step ?? body.onboardingStep,
  }

  const params = [
    userId,
    fields.display_name,
    fields.age,
    fields.gender,
    fields.height_cm,
    fields.weight_kg,
    fields.target_weight_kg,
    fields.waist_cm,
    fields.activity_level,
    fields.job_activity_level,
    fields.sleep_hours,
    fields.goal,
    fields.workout_goal,
    fields.dietary_preference,
    fields.allergies,
    fields.disliked_foods,
    JSON.stringify(fields.usual_meal_timing),
    fields.gym_experience,
    JSON.stringify(fields.available_gym_days),
    fields.injuries_pain_areas,
    JSON.stringify(fields.medical_caution_flags),
    fields.medical_caution_notes,
    fields.supplement_usage,
    fields.daily_water_baseline_ml,
    fields.caffeine_intake,
    fields.digestion_probiotic_habits,
    fields.budget_level,
    fields.preferred_foods,
    fields.onboarding_completed,
    fields.onboarding_step,
  ]

  if (existing) {
    const { rows } = await query(
      `UPDATE nutrition_profiles SET
        display_name = COALESCE($2, display_name),
        age = COALESCE($3, age),
        gender = COALESCE($4, gender),
        height_cm = COALESCE($5, height_cm),
        weight_kg = COALESCE($6, weight_kg),
        target_weight_kg = COALESCE($7, target_weight_kg),
        waist_cm = COALESCE($8, waist_cm),
        activity_level = COALESCE($9, activity_level),
        job_activity_level = COALESCE($10, job_activity_level),
        sleep_hours = COALESCE($11, sleep_hours),
        goal = COALESCE($12, goal),
        workout_goal = COALESCE($13, workout_goal),
        dietary_preference = COALESCE($14, dietary_preference),
        allergies = COALESCE($15, allergies),
        disliked_foods = COALESCE($16, disliked_foods),
        usual_meal_timing = COALESCE($17::jsonb, usual_meal_timing),
        gym_experience = COALESCE($18, gym_experience),
        available_gym_days = COALESCE($19::jsonb, available_gym_days),
        injuries_pain_areas = COALESCE($20, injuries_pain_areas),
        medical_caution_flags = COALESCE($21::jsonb, medical_caution_flags),
        medical_caution_notes = COALESCE($22, medical_caution_notes),
        supplement_usage = COALESCE($23, supplement_usage),
        daily_water_baseline_ml = COALESCE($24, daily_water_baseline_ml),
        caffeine_intake = COALESCE($25, caffeine_intake),
        digestion_probiotic_habits = COALESCE($26, digestion_probiotic_habits),
        budget_level = COALESCE($27, budget_level),
        preferred_foods = COALESCE($28, preferred_foods),
        onboarding_completed = COALESCE($29, onboarding_completed),
        onboarding_step = COALESCE($30, onboarding_step),
        updated_at = NOW()
       WHERE user_id = $1 RETURNING *`,
      params,
    )
    return rows[0]
  }

  const { rows } = await query(
    `INSERT INTO nutrition_profiles (
      user_id, display_name, age, gender, height_cm, weight_kg, target_weight_kg, waist_cm,
      activity_level, job_activity_level, sleep_hours, goal, workout_goal, dietary_preference,
      allergies, disliked_foods, usual_meal_timing, gym_experience, available_gym_days,
      injuries_pain_areas, medical_caution_flags, medical_caution_notes, supplement_usage,
      daily_water_baseline_ml, caffeine_intake, digestion_probiotic_habits, budget_level,
      preferred_foods, onboarding_completed, onboarding_step
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19::jsonb,$20,$21::jsonb,$22,$23,$24,$25,$26,$27,$28,$29,$30)
    RETURNING *`,
    params,
  )
  return rows[0]
}

async function listFoodLibrary(userId, search = '', filters = {}) {
  const q = String(search || filters.q || '').trim().toLowerCase()
  const params = [userId]
  let where = `(user_id IS NULL OR user_id = $1) AND is_active = true`
  if (q) {
    params.push(`%${q}%`)
    where += ` AND LOWER(name) LIKE $${params.length}`
  }
  if (filters.origin_region) {
    params.push(filters.origin_region)
    where += ` AND origin_region = $${params.length}`
  }
  if (filters.diet_tag) {
    params.push(filters.diet_tag)
    where += ` AND $${params.length} = ANY(diet_tags)`
  }
  if (filters.nutrient_tag) {
    params.push(filters.nutrient_tag)
    where += ` AND $${params.length} = ANY(nutrient_tags)`
  }
  const { rows } = await query(
    `SELECT * FROM food_library WHERE ${where} ORDER BY origin_region NULLS LAST, user_id NULLS FIRST, name LIMIT 500`,
    params,
  )
  let foods = rows.map(formatFoodLibraryRow)
  foods = foods.filter((f) => matchesLibraryFilters(f, filters))
  return foods
}

async function createFoodLibraryItem(userId, body) {
  const { rows } = await query(
    `INSERT INTO food_library (user_id, name, serving_unit, serving_size, nutrients, tags, image_url, image_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      userId,
      body.name,
      body.serving_unit || body.servingUnit || 'g',
      body.serving_size ?? body.servingSize ?? 100,
      JSON.stringify(body.nutrients || {}),
      body.tags || [],
      body.image_url || body.imageUrl || imageUrlForFoodName(body.name),
      body.image_key || body.imageKey || null,
    ],
  )
  return { ...rows[0], nutrients: parseJson(rows[0].nutrients, {}) }
}

async function getOrCreateFoodLog(userId, logDate) {
  const date = logDate || todayIso()
  let { rows } = await query(`SELECT * FROM food_logs WHERE user_id = $1 AND log_date = $2`, [userId, date])
  if (rows[0]) return rows[0]
  const ins = await query(
    `INSERT INTO food_logs (user_id, log_date) VALUES ($1, $2) RETURNING *`,
    [userId, date],
  )
  return ins.rows[0]
}

async function listFoodLogItems(userId, logDate) {
  const log = await getOrCreateFoodLog(userId, logDate)
  const { rows } = await query(
    `SELECT fi.*, fl.image_url, fl.image_key
     FROM food_log_items fi
     LEFT JOIN food_library fl ON fl.id = fi.food_library_id
     WHERE fi.food_log_id = $1 ORDER BY fi.created_at`,
    [log.id],
  )
  return rows.map((r) => ({
    ...r,
    nutrients: parseJson(r.nutrients, {}),
    quantity: Number(r.quantity),
    image_url: r.image_url || imageUrlForFoodName(r.food_name),
  }))
}

async function resolveLogItemNutrients(userId, item) {
  const library = await listFoodLibrary(userId, '')
  let food = null
  if (item.food_library_id) {
    const { rows } = await query(`SELECT * FROM food_library WHERE id = $1`, [item.food_library_id])
    food = rows[0] || null
  }
  if (!food) {
    food = findLibraryFoodByName(library, item.food_name)
  }
  if (!food) return { updated: false, item }

  const nutrients = scaleNutrients(
    parseJson(food.nutrients, {}),
    item.quantity ?? 1,
    Number(food.serving_size),
    item.unit || '',
  )
  const current = parseJson(item.nutrients, {})
  const changed = Number(current.calories || 0) !== Number(nutrients.calories || 0)
    || !item.food_library_id
  if (changed) {
    await query(
      `UPDATE food_log_items SET nutrients = $2, food_library_id = $3, food_name = $4 WHERE id = $1`,
      [item.id, JSON.stringify(nutrients), food.id, food.name],
    )
  }
  return {
    updated: changed,
    item: { ...item, food_name: food.name, food_library_id: food.id, nutrients },
  }
}

async function addFoodLogItem(userId, body) {
  const logDate = body.log_date || body.logDate || todayIso()
  const log = await getOrCreateFoodLog(userId, logDate)
  let nutrients = body.nutrients || {}
  let foodLibraryId = body.food_library_id ?? body.foodLibraryId ?? null
  let foodName = body.food_name || body.foodName
  const unit = body.unit || ''

  if (!foodLibraryId && foodName) {
    const library = await listFoodLibrary(userId, '')
    const match = findLibraryFoodByName(library, foodName)
    if (match) {
      foodLibraryId = match.id
      foodName = match.name
    }
  }

  if (foodLibraryId) {
    const { rows } = await query(`SELECT * FROM food_library WHERE id = $1`, [foodLibraryId])
    if (rows[0]) {
      nutrients = scaleNutrients(
        parseJson(rows[0].nutrients, {}),
        body.quantity ?? 1,
        Number(rows[0].serving_size),
        unit,
      )
      foodName = rows[0].name
    }
  } else if (body.base_nutrients || body.baseNutrients) {
    nutrients = scaleNutrients(
      body.base_nutrients || body.baseNutrients,
      body.quantity ?? 1,
      body.serving_size ?? body.servingSize ?? 100,
      unit,
    )
  }

  const { rows } = await query(
    `INSERT INTO food_log_items (food_log_id, meal_type, food_name, food_library_id, quantity, unit, nutrients, why_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      log.id,
      body.meal_type || body.mealType || 'snack',
      foodName,
      foodLibraryId,
      body.quantity ?? 1,
      unit,
      JSON.stringify(nutrients),
      body.why_notes || body.whyNotes || body.notes || '',
    ],
  )
  await recomputeDailySummary(userId, logDate)
  const saved = rows[0]
  return {
    ...saved,
    nutrients: parseJson(saved.nutrients, {}),
    image_url: imageUrlForFoodName(foodName),
  }
}

async function deleteFoodLogItem(userId, itemId) {
  const { rows } = await query(
    `DELETE FROM food_log_items fi
     USING food_logs fl
     WHERE fi.id = $1 AND fi.food_log_id = fl.id AND fl.user_id = $2
     RETURNING fi.*, fl.log_date`,
    [itemId, userId],
  )
  if (rows[0]) await recomputeDailySummary(userId, rows[0].log_date)
  return rows[0] || null
}

async function recomputeDailySummary(userId, logDate) {
  const date = logDate || todayIso()
  const rawItems = await listFoodLogItems(userId, date)
  for (const item of rawItems) {
    await resolveLogItemNutrients(userId, item)
  }
  const items = await listFoodLogItems(userId, date)
  const profile = await getProfile(userId)
  const dbTargets = await getNutrientTargets()
  const summary = computeDailySummary({ items, profile, dbTargets })

  await query(
    `INSERT INTO nutrient_daily_summary (
      user_id, summary_date, totals, targets, coverage, missing_nutrients,
      food_quality_score, hydration_ml, computed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    ON CONFLICT (user_id, summary_date) DO UPDATE SET
      totals = EXCLUDED.totals,
      targets = EXCLUDED.targets,
      coverage = EXCLUDED.coverage,
      missing_nutrients = EXCLUDED.missing_nutrients,
      food_quality_score = EXCLUDED.food_quality_score,
      hydration_ml = EXCLUDED.hydration_ml,
      computed_at = NOW()`,
    [
      userId,
      date,
      JSON.stringify(summary.totals),
      JSON.stringify(summary.targets),
      JSON.stringify(summary.coverage),
      JSON.stringify(summary.missingNutrients),
      summary.foodQualityScore,
      summary.hydrationMl,
    ],
  )
  return summary
}

async function getDailySummary(userId, logDate) {
  const date = logDate || todayIso()
  await recomputeDailySummary(userId, date)
  const { rows } = await query(
    `SELECT * FROM nutrient_daily_summary WHERE user_id = $1 AND summary_date = $2`,
    [userId, date],
  )
  if (!rows[0]) return null
  const r = rows[0]
  const coverage = parseJson(r.coverage, {})
  return {
    ...r,
    totals: parseJson(r.totals, {}),
    targets: parseJson(r.targets, {}),
    coverage,
    cards: require('./nutrition/nutrientCalculation').buildCoverageCards(coverage),
    missing_nutrients: parseJson(r.missing_nutrients, []),
    disclaimer: WELLNESS_DISCLAIMER,
  }
}

async function getDashboard(userId) {
  const date = todayIso()
  const summary = await getDailySummary(userId, date)
  const items = await listFoodLogItems(userId, date)
  const profile = await getProfile(userId)

  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - 6)
  const { rows: weightRows } = await query(
    `SELECT log_date, weight_kg FROM progress_logs
     WHERE user_id = $1 AND log_date >= $2 AND weight_kg IS NOT NULL
     ORDER BY log_date`,
    [userId, weekStart.toISOString().slice(0, 10)],
  )

  const { rows: sessionRows } = await query(
    `SELECT * FROM workout_sessions WHERE user_id = $1 AND session_date = $2 LIMIT 1`,
    [userId, date],
  )

  const { rows: streakRows } = await query(
    `SELECT summary_date, food_quality_score FROM nutrient_daily_summary
     WHERE user_id = $1 AND summary_date >= $2 ORDER BY summary_date DESC`,
    [userId, weekStart.toISOString().slice(0, 10)],
  )

  let streak = 0
  for (const row of streakRows) {
    if (Number(row.food_quality_score) >= 60) streak++
    else break
  }

  const topMissing = (summary?.missing_nutrients || []).slice(0, 5)
  const suggestionFoods = await getSuggestionFoodsWithImages(userId, topMissing, profile)

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yDate = yesterday.toISOString().slice(0, 10)
  const ySummary = await getDailySummary(userId, yDate)

  const calculators = profile ? computeAllCalculators(profile) : null
  const library = await listFoodLibrary(userId, '')
  const mediterraneanPlate = isMediterraneanMode(profile?.dietary_preference)
    ? buildMediterraneanPlate(library, profile)
    : null
  const worldDietPlate = isWorldDietMode(profile?.dietary_preference)
    ? buildWorldPlate(library, profile)
    : null

  return {
    date,
    disclaimer: WELLNESS_DISCLAIMER,
    calories: summary?.totals?.calories || 0,
    calorieTarget: summary?.targets?.calories?.target || calculators?.calorieTarget || 2200,
    protein: summary?.totals?.protein || 0,
    proteinTarget: summary?.targets?.protein?.target || calculators?.proteinTargetG || 90,
    waterMl: summary?.hydration_ml || 0,
    waterTarget: summary?.targets?.waterMl?.target || calculators?.waterTargetMl || 2500,
    topMissingNutrients: topMissing,
    foodQualityScore: summary?.food_quality_score || 0,
    workoutCompleted: sessionRows[0]?.completed || false,
    weeklyWeightTrend: weightRows,
    nutrientStreak: streak,
    suggestionFoods,
    bestSuggestions: suggestionFoods.map((f) => f.name).slice(0, 6),
    cards: summary?.cards || [],
    itemCount: items.length,
    profileComplete: !!profile?.onboarding_completed,
    onboardingCompleted: !!profile?.onboarding_completed,
    displayName: profile?.display_name || null,
    compareYesterday: {
      date: yDate,
      calories: ySummary?.totals?.calories || 0,
      protein: ySummary?.totals?.protein || 0,
      waterMl: ySummary?.hydration_ml || 0,
      foodQualityScore: ySummary?.food_quality_score || 0,
      deltaCalories: (summary?.totals?.calories || 0) - (ySummary?.totals?.calories || 0),
      deltaProtein: (summary?.totals?.protein || 0) - (ySummary?.totals?.protein || 0),
      deltaWater: (summary?.hydration_ml || 0) - (ySummary?.hydration_ml || 0),
      deltaQuality: (summary?.food_quality_score || 0) - (ySummary?.food_quality_score || 0),
    },
    calculators,
    mediterraneanMode: isMediterraneanMode(profile?.dietary_preference),
    mediterraneanPlate,
    fatComparison: analyzeFatIntake(summary?.totals || {}, items),
    worldDietMode: isWorldDietMode(profile?.dietary_preference),
    worldPlate: worldDietPlate,
    foodFilterOptions: buildFoodFilterOptions(library),
  }
}

async function getSuggestionFoodsWithImages(userId, missingNutrients, profile) {
  const library = await listFoodLibrary(userId, '')
  const prof = profile || await getProfile(userId)
  const worldMode = isWorldDietMode(prof?.dietary_preference)
  const medMode = isMediterraneanMode(prof?.dietary_preference)

  let suggestionsMap = NUTRIENT_FOOD_SUGGESTIONS
  if (worldMode) suggestionsMap = worldDietNutrientSuggestions()
  else if (medMode) suggestionsMap = mediterraneanNutrientSuggestions()

  if (worldMode && (!missingNutrients || missingNutrients.length === 0)) {
    return getWorldDietFoodSuggestions(library, 12).map((f) => ({
      ...f,
      nutrientKey: 'world_diet',
      whyNotes: f.why_recommended,
    }))
  }

  if (medMode && (!missingNutrients || missingNutrients.length === 0)) {
    return getMediterraneanFoodSuggestions(library, 12).map((f) => ({ ...f, nutrientKey: 'mediterranean' }))
  }

  const names = new Set()
  const out = []
  for (const m of missingNutrients || []) {
    const list = m.suggestions || suggestionsMap[m.key] || []
    for (const suggestion of list) {
      const key = String(suggestion).toLowerCase()
      if (names.has(key)) continue
      const match = findLibraryFoodByName(library, suggestion) || findLibraryFoodByName(library, key)
      out.push({
        name: match?.name || suggestion,
        id: match?.id || null,
        image_url: imageUrlForFoodName(match?.name || suggestion) || match?.image_url || null,
        nutrientKey: m.key,
        whyNotes: match?.why_recommended || null,
        origin_region: match?.origin_region || null,
        caution_notes: match?.caution_notes || [],
      })
      names.add(key)
      if (out.length >= 12) return out
    }
  }
  return out
}

async function getCalculators(userId) {
  const profile = await getProfile(userId)
  if (!profile) {
    return { calculators: null, disclaimer: WELLNESS_DISCLAIMER, message: 'Complete your profile for personalized calculators.' }
  }
  return { calculators: computeAllCalculators(profile), profile, disclaimer: WELLNESS_DISCLAIMER }
}

async function getWhatToEatNext(userId) {
  const summary = await getDailySummary(userId, todayIso())
  const profile = await getProfile(userId)
  const nextMeal = suggestNextMeal(summary)
  const foods = await getSuggestionFoodsWithImages(userId, summary?.missing_nutrients || [], profile)
  return { ...nextMeal, foods, disclaimer: WELLNESS_DISCLAIMER }
}

async function fixTodayNutrition(userId) {
  const summary = await getDailySummary(userId, todayIso())
  const profile = await getProfile(userId)
  const missing = (summary?.missing_nutrients || []).slice(0, 5)
  const foods = await getSuggestionFoodsWithImages(userId, missing, profile)
  const mealReplacements = foods.slice(0, 4).map((f) => ({
    ...f,
    action: 'add',
    mealType: 'snack',
    message: `Add ${f.name} to help cover ${f.nutrientKey || 'nutrients'}.`,
  }))
  return {
    missing,
    mealReplacements,
    foods,
    disclaimer: WELLNESS_DISCLAIMER,
  }
}

/** Parse natural language food input — returns candidates for confirmation */
async function parseFoodAssistant(userId, text) {
  const input = String(text || '').toLowerCase()
  const library = await listFoodLibrary(userId, '')
  const tokens = input.split(/[,+\n]+/).map((t) => t.trim()).filter(Boolean)
  const parsed = []

  for (const token of tokens) {
    const qtyMatch = token.match(/^(\d+(?:\.\d+)?)\s*(?:x|×)?\s*(.+)$/)
    const qty = qtyMatch ? Number(qtyMatch[1]) : 1
    const namePart = (qtyMatch ? qtyMatch[2] : token).trim()
    const best = findLibraryFoodByName(library, namePart)
    const confidence = best ? 'high' : 'none'

    parsed.push({
      inputToken: token,
      quantity: qty,
      matched: !!best,
      confidence,
      food: best
        ? {
            id: best.id,
            name: best.name,
            serving_unit: best.serving_unit,
            serving_size: best.serving_size,
            image_url: best.image_url || imageUrlForFoodName(best.name),
            estimatedNutrients: scaleNutrients(
              best.nutrients,
              qty,
              Number(best.serving_size),
              '',
            ),
          }
        : null,
      foodName: best ? best.name : namePart,
    })
  }

  return {
    parsed,
    requiresConfirmation: true,
    disclaimer: WELLNESS_DISCLAIMER,
    message: 'Review parsed foods below. Nothing is saved until you confirm.',
  }
}

async function confirmAssistantLog(userId, body) {
  const items = body.items || []
  const logDate = body.log_date || body.logDate || todayIso()
  const mealType = body.meal_type || body.mealType || 'snack'
  const saved = []
  for (const item of items) {
    if (item.confirmed === false) continue
    saved.push(
      await addFoodLogItem(userId, {
        logDate,
        mealType: item.meal_type || mealType,
        foodName: item.food_name || item.foodName,
        foodLibraryId: item.food_library_id || item.foodLibraryId,
        quantity: item.quantity ?? 1,
        unit: item.unit,
        nutrients: item.nutrients,
        whyNotes: item.why_notes || 'AI assistant log',
      }),
    )
  }
  const summary = await getDailySummary(userId, logDate)
  const nextMeal = suggestNextMeal(summary)
  const gymSuggestion = suggestGymForToday(userId)
  return { saved, summary, nextMeal, gymSuggestion, disclaimer: WELLNESS_DISCLAIMER }
}

function suggestNextMeal(summary) {
  const missing = summary?.missing_nutrients || []
  if (missing.length === 0) {
    return { message: 'Good coverage so far. A balanced snack with protein and fiber is a safe choice.', foods: ['Greek yogurt', 'mixed nuts'] }
  }
  const top = missing[0]
  return {
    message: `Consider adding foods rich in ${top.displayName} for your next meal.`,
    foods: (top.suggestions || NUTRIENT_FOOD_SUGGESTIONS[top.key] || []).slice(0, 5),
  }
}

async function suggestGymForToday(userId) {
  const date = todayIso()
  const day = new Date().getDay()
  const { rows } = await query(
    `SELECT * FROM workout_plans WHERE user_id = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  )
  const plan = rows[0]
  const schedule = plan ? parseJson(plan.weekly_schedule, {}) : null
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayKey = dayNames[day]
  const todayPlan = schedule?.[dayKey]

  if (!todayPlan) {
    return {
      type: day === 0 || day === 6 ? 'rest' : 'light_cardio',
      message: 'Rest or light activity day. Focus on walking, stretching, and hydration.',
      safetyNotes: FITNESS_SAFETY_NOTES,
    }
  }
  return {
    type: todayPlan.type || 'workout',
    ...todayPlan,
    safetyNotes: FITNESS_SAFETY_NOTES,
    disclaimer: WELLNESS_DISCLAIMER,
  }
}

async function generateMealPlan(userId, body) {
  const profile = await getProfile(userId)
  const summary = await getDailySummary(userId, body.plan_date || body.planDate || todayIso())
  const library = await listFoodLibrary(userId, '')
  const calorieTarget = body.calorie_target ?? body.calorieTarget ?? summary?.targets?.calories?.target ?? 2200
  const proteinTarget = body.protein_target ?? body.proteinTarget ?? summary?.targets?.protein?.target ?? 90
  const missing = (summary?.missing_nutrients || []).map((m) => m.key)

  const preferTags = []
  if (profile?.dietary_preference === 'vegetarian') preferTags.push('fiber')
  if (profile?.dietary_preference === 'high_protein') preferTags.push('protein')
  if (isMediterraneanMode(profile?.dietary_preference)) preferTags.push('mediterranean')
  if (isWorldDietMode(profile?.dietary_preference)) preferTags.push('world_diet')
  preferTags.push('uae')

  function pickFoods(count, mealTag) {
    const pool = library.filter((f) => {
      if (isWorldDietMode(profile?.dietary_preference)) {
        return (f.diet_tags || []).includes('world_diet') || f.tags?.includes(mealTag) || (f.nutrient_tags || []).includes(mealTag) || f.tags?.some((t) => preferTags.includes(t))
      }
      if (isMediterraneanMode(profile?.dietary_preference)) {
        return f.tags?.includes('mediterranean') || f.tags?.includes(mealTag) || f.tags?.some((t) => preferTags.includes(t))
      }
      return f.tags?.includes(mealTag) || f.tags?.some((t) => preferTags.includes(t))
    })
    return pool.slice(0, count).map((f) => ({
      name: f.name,
      id: f.id,
      nutrients: f.nutrients,
      image_url: f.image_url || imageUrlForFoodName(f.name),
      why_recommended: f.why_recommended,
    }))
  }

  const worldPlate = isWorldDietMode(profile?.dietary_preference)
    ? buildWorldPlate(library, profile)
    : null
  const medPlate = isMediterraneanMode(profile?.dietary_preference) && !worldPlate
    ? buildMediterraneanPlate(library, profile)
    : null

  let planData
  if (worldPlate) {
    planData = {
      worldPlate,
      breakfast: pickFoods(1, 'protein').concat(pickFoods(1, 'slow_carb')),
      lunch: [
        { name: worldPlate.slots.protein?.suggestion || 'Lentils (cooked)', image_url: imageUrlForFoodName('lentils') },
        { name: worldPlate.slots.carb?.suggestion || 'Brown rice (cooked)', image_url: imageUrlForFoodName('rice') },
        { name: worldPlate.slots.vegetables?.suggestion || 'Spinach (raw)', image_url: imageUrlForFoodName('spinach') },
        { name: worldPlate.slots.healthyFat?.suggestion || 'Olive oil', image_url: imageUrlForFoodName('olive oil') },
        { name: worldPlate.slots.probiotic?.suggestion || 'Greek yogurt (plain)', image_url: imageUrlForFoodName('yogurt') },
      ],
      dinner: pickFoods(1, 'high_protein').concat(pickFoods(1, 'vegetables')).concat(pickFoods(1, 'healthy_fats')),
      snacks: pickFoods(1, 'healthy_fats').concat(pickFoods(1, 'fermented')),
      preWorkout: [{ name: 'Banana', image_url: imageUrlForFoodName('banana'), note: 'Light carbs before training' }],
      postWorkout: pickFoods(1, 'high_protein').concat([{ name: worldPlate.slots.hydration?.suggestion || 'Water', image_url: imageUrlForFoodName('water'), note: 'Rehydrate after training' }]),
      missingNutrientsAddressed: missing.slice(0, 5),
      notes: `${worldPlate.regionLabel} inspired plan using proven traditional foods. No miracle claims — balance portions and respect allergy cautions.`,
      fatGuidance: analyzeFatIntake(summary?.totals || {}, await listFoodLogItems(userId, body.plan_date || body.planDate || todayIso())),
      disclaimer: WELLNESS_DISCLAIMER,
    }
  } else if (medPlate) {
    planData = {
        mediterraneanPlate: medPlate,
        breakfast: pickFoods(1, 'protein').concat(pickFoods(1, 'carbs')),
        lunch: [
          { name: medPlate.slots.protein?.suggestion || 'Chicken breast (grilled)', image_url: imageUrlForFoodName('chicken') },
          { name: medPlate.slots.wholeGrain?.suggestion || 'Brown rice (cooked)', image_url: imageUrlForFoodName('brown rice') },
          { name: medPlate.slots.vegetables?.suggestion || 'Cucumber & tomato salad', image_url: imageUrlForFoodName('cucumber') },
          { name: medPlate.slots.healthyFat?.suggestion || 'Olive oil', image_url: imageUrlForFoodName('olive oil') },
        ],
        dinner: pickFoods(1, 'protein').concat(pickFoods(1, 'vegetables')).concat(pickFoods(1, 'good-fats')),
        snacks: pickFoods(1, 'good-fats').concat(pickFoods(1, 'probiotics')),
        preWorkout: [{ name: 'Banana', image_url: imageUrlForFoodName('banana'), note: 'Light carbs before training' }],
        postWorkout: pickFoods(1, 'protein').concat([{ name: 'Greek yogurt (plain)', image_url: imageUrlForFoodName('yogurt'), note: 'Protein + probiotics' }]),
        missingNutrientsAddressed: missing.slice(0, 5),
        notes: 'Mediterranean-style plan emphasizing olive oil, legumes, fish, yogurt, vegetables, and nuts. Desi ghee optional in small portions.',
        fatGuidance: analyzeFatIntake(summary?.totals || {}, await listFoodLogItems(userId, body.plan_date || body.planDate || todayIso())),
        disclaimer: WELLNESS_DISCLAIMER,
      }
  } else {
    planData = {
    breakfast: pickFoods(2, 'carbs').concat(pickFoods(1, 'protein')),
    lunch: pickFoods(2, 'protein').concat(pickFoods(1, 'fiber')),
    dinner: pickFoods(1, 'protein').concat(pickFoods(2, 'fiber')),
    snacks: pickFoods(2, 'good-fats'),
    preWorkout: [{ name: 'Banana', image_url: imageUrlForFoodName('banana'), note: 'Light carbs ~30 min before training' }],
    postWorkout: pickFoods(1, 'protein').concat([{ name: 'Greek yogurt (plain)', image_url: imageUrlForFoodName('yogurt'), note: 'Protein + probiotics' }]),
    missingNutrientsAddressed: missing.slice(0, 5),
    notes: 'Simple UAE-friendly meal plan based on your profile and nutrient gaps. Adjust portions to meet calorie/protein targets.',
    disclaimer: WELLNESS_DISCLAIMER,
  }
  }

  const { rows } = await query(
    `INSERT INTO meal_plans (user_id, plan_date, title, plan_data, calorie_target, protein_target)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      userId,
      body.plan_date || body.planDate || todayIso(),
      body.title || 'Daily meal plan',
      JSON.stringify(planData),
      calorieTarget,
      proteinTarget,
    ],
  )
  return { ...rows[0], plan_data: planData, disclaimer: WELLNESS_DISCLAIMER }
}

async function listMealPlans(userId, limit = 14) {
  const { rows } = await query(
    `SELECT * FROM meal_plans WHERE user_id = $1 ORDER BY plan_date DESC LIMIT $2`,
    [userId, limit],
  )
  return rows.map((r) => ({ ...r, plan_data: parseJson(r.plan_data, {}) }))
}

function defaultWorkoutPlan(level = 'beginner') {
  const schedule = {
    monday: { type: 'strength', muscleGroups: ['chest', 'triceps'], exercises: [{ name: 'Bench press or push-ups', sets: 3, reps: '8-12', rpe: 7 }, { name: 'Dumbbell flyes', sets: 3, reps: '10-12', rpe: 7 }], warmup: '5 min light cardio + arm circles', cooldown: '5 min stretch', cardio: '10 min brisk walk' },
    tuesday: { type: 'rest', message: 'Rest day — light walking and stretching only' },
    wednesday: { type: 'strength', muscleGroups: ['back', 'biceps'], exercises: [{ name: 'Lat pulldown or rows', sets: 3, reps: '8-12', rpe: 7 }, { name: 'Bicep curls', sets: 3, reps: '10-12', rpe: 7 }], warmup: '5 min row machine or band pull-aparts', cooldown: '5 min stretch' },
    thursday: { type: 'cardio', exercises: [{ name: 'Brisk walk or cycling', sets: 1, reps: '25-30 min', rpe: 6 }], notes: 'Moderate intensity — you should be able to hold a conversation' },
    friday: { type: 'strength', muscleGroups: ['legs', 'glutes'], exercises: [{ name: 'Squats or leg press', sets: 3, reps: '8-12', rpe: 7 }, { name: 'Romanian deadlift', sets: 3, reps: '8-10', rpe: 7 }, { name: 'Calf raises', sets: 3, reps: '12-15', rpe: 7 }], warmup: '5 min bike + bodyweight squats', cooldown: '5 min leg stretch' },
    saturday: { type: 'strength', muscleGroups: ['shoulders', 'core'], exercises: [{ name: 'Overhead press', sets: 3, reps: '8-10', rpe: 7 }, { name: 'Plank', sets: 3, reps: '30-45 sec', rpe: 7 }], warmup: 'Shoulder mobility drills', cooldown: 'Full body stretch' },
    sunday: { type: 'rest', message: 'Full rest — prioritize sleep and hydration for recovery' },
  }
  return {
    title: level === 'intermediate' ? 'Intermediate 4-day split' : 'Beginner full-body split',
    level,
    weekly_schedule: schedule,
    safety_notes: FITNESS_SAFETY_NOTES.join('\n'),
    progressiveOverload: 'When you can complete all sets at top rep range with good form, increase weight by 2.5–5% next session.',
    recoveryNotes: 'Aim for 7–9 hours sleep. Include rest days — do not train the same muscle group hard on consecutive days.',
  }
}

async function getOrCreateWorkoutPlan(userId, level) {
  const { rows } = await query(
    `SELECT * FROM workout_plans WHERE user_id = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  )
  if (rows[0]) return { ...rows[0], weekly_schedule: parseJson(rows[0].weekly_schedule, {}) }
  const plan = defaultWorkoutPlan(level || 'beginner')
  const ins = await query(
    `INSERT INTO workout_plans (user_id, title, level, weekly_schedule, safety_notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, plan.title, plan.level, JSON.stringify(plan.weekly_schedule), plan.safety_notes],
  )
  return { ...ins.rows[0], weekly_schedule: plan.weekly_schedule, progressiveOverload: plan.progressiveOverload, recoveryNotes: plan.recoveryNotes }
}

async function upsertWorkoutSession(userId, body) {
  const sessionDate = body.session_date || body.sessionDate || todayIso()
  const { rows: existing } = await query(
    `SELECT id FROM workout_sessions WHERE user_id = $1 AND session_date = $2 LIMIT 1`,
    [userId, sessionDate],
  )
  let sessionId
  if (existing[0]) {
    sessionId = existing[0].id
    await query(
      `UPDATE workout_sessions SET completed = $3, duration_minutes = $4, notes = $5, body = $6, session_type = $7
       WHERE id = $1 AND user_id = $2`,
      [sessionId, userId, body.completed ?? true, body.duration_minutes ?? body.durationMinutes, body.notes, JSON.stringify(body.body || {}), body.session_type || body.sessionType],
    )
  } else {
    const ins = await query(
      `INSERT INTO workout_sessions (user_id, workout_plan_id, session_date, session_type, completed, duration_minutes, notes, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [userId, body.workout_plan_id ?? body.workoutPlanId, sessionDate, body.session_type || body.sessionType, body.completed ?? true, body.duration_minutes ?? body.durationMinutes, body.notes, JSON.stringify(body.body || {})],
    )
    sessionId = ins.rows[0].id
  }

  if (Array.isArray(body.exercises)) {
    await query(`DELETE FROM workout_exercises WHERE workout_session_id = $1`, [sessionId])
    for (let i = 0; i < body.exercises.length; i++) {
      const ex = body.exercises[i]
      await query(
        `INSERT INTO workout_exercises (workout_session_id, muscle_group, exercise_name, sets, reps, weight_kg, rpe, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [sessionId, ex.muscle_group || ex.muscleGroup, ex.exercise_name || ex.exerciseName, ex.sets, ex.reps, ex.weight_kg ?? ex.weightKg, ex.rpe, ex.notes, i],
      )
    }
  }
  const { rows } = await query(`SELECT * FROM workout_sessions WHERE id = $1`, [sessionId])
  return rows[0]
}

async function listWorkoutSessions(userId, fromDate, toDate) {
  const { rows } = await query(
    `SELECT ws.*, (
       SELECT json_agg(json_build_object(
         'id', we.id, 'muscle_group', we.muscle_group, 'exercise_name', we.exercise_name,
         'sets', we.sets, 'reps', we.reps, 'weight_kg', we.weight_kg, 'rpe', we.rpe, 'notes', we.notes
       ) ORDER BY we.sort_order)
       FROM workout_exercises we WHERE we.workout_session_id = ws.id
     ) AS exercises
     FROM workout_sessions ws
     WHERE ws.user_id = $1 AND ws.session_date >= $2 AND ws.session_date <= $3
     ORDER BY ws.session_date DESC`,
    [userId, fromDate, toDate],
  )
  return rows
}

async function addProgressLog(userId, body) {
  const { rows } = await query(
    `INSERT INTO progress_logs (user_id, log_date, weight_kg, body_fat_pct, notes, metrics)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [userId, body.log_date || body.logDate || todayIso(), body.weight_kg ?? body.weightKg, body.body_fat_pct ?? body.bodyFatPct, body.notes, JSON.stringify(body.metrics || {})],
  )
  return rows[0]
}

async function listProgressLogs(userId, limit = 90) {
  const { rows } = await query(
    `SELECT * FROM progress_logs WHERE user_id = $1 ORDER BY log_date DESC LIMIT $2`,
    [userId, limit],
  )
  return rows
}

async function getMediterraneanPlate(userId) {
  const profile = await getProfile(userId)
  const library = await listFoodLibrary(userId, '')
  const items = await listFoodLogItems(userId, todayIso())
  const summary = await getDailySummary(userId, todayIso())
  return {
    mediterraneanMode: isMediterraneanMode(profile?.dietary_preference),
    plate: buildMediterraneanPlate(library, profile || {}),
    fatComparison: analyzeFatIntake(summary?.totals || {}, items),
    disclaimer: WELLNESS_DISCLAIMER,
  }
}

async function getWorldDietPlate(userId, query = {}) {
  const profile = await getProfile(userId)
  const library = await listFoodLibrary(userId, '')
  const region = query.region || query.culture || null
  return {
    worldDietMode: isWorldDietMode(profile?.dietary_preference),
    plate: buildWorldPlate(library, profile || {}, region),
    filterOptions: buildFoodFilterOptions(library),
    disclaimer: WELLNESS_DISCLAIMER,
  }
}

async function getMeta() {
  return {
    disclaimer: WELLNESS_DISCLAIMER,
    mealTypes: MEAL_TYPES,
    fitnessSafetyNotes: FITNESS_SAFETY_NOTES,
    nutrientSuggestions: NUTRIENT_FOOD_SUGGESTIONS,
    mediterraneanDietModes: MEDITERRANEAN_DIET_MODES,
    worldDietModes: WORLD_DIET_MODES,
    foodCategoryFilters: FOOD_CATEGORY_FILTERS,
  }
}

module.exports = {
  ensureNutritionCoachTables,
  getMeta,
  getProfile,
  upsertProfile,
  listFoodLibrary,
  createFoodLibraryItem,
  listFoodLogItems,
  addFoodLogItem,
  deleteFoodLogItem,
  getDailySummary,
  getDashboard,
  getCalculators,
  getWhatToEatNext,
  fixTodayNutrition,
  getSuggestionFoodsWithImages,
  getMediterraneanPlate,
  getWorldDietPlate,
  parseFoodAssistant,
  confirmAssistantLog,
  generateMealPlan,
  listMealPlans,
  getOrCreateWorkoutPlan,
  upsertWorkoutSession,
  listWorkoutSessions,
  addProgressLog,
  listProgressLogs,
  getNutrientTargets,
  updateNutrientTarget,
  recomputeDailySummary,
  emptyNutrients,
}
