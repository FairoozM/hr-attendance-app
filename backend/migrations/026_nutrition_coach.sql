-- Nutrition & Fitness Coach module tables.
-- Idempotent DDL. Applied on server boot via ensureNutritionCoachTables() in db/index.js.
-- Manual: psql "$DATABASE_URL" -f backend/migrations/026_nutrition_coach.sql

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
);

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
);

CREATE INDEX IF NOT EXISTS idx_food_library_user ON food_library(user_id);
CREATE INDEX IF NOT EXISTS idx_food_library_name ON food_library(LOWER(name));

CREATE TABLE IF NOT EXISTS food_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, log_date DESC);

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
);

CREATE INDEX IF NOT EXISTS idx_food_log_items_log ON food_log_items(food_log_id);

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
);

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
);

CREATE INDEX IF NOT EXISTS idx_nutrient_daily_summary_user ON nutrient_daily_summary(user_id, summary_date DESC);

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
);

CREATE INDEX IF NOT EXISTS idx_meal_plans_user_date ON meal_plans(user_id, plan_date DESC);

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
);

CREATE INDEX IF NOT EXISTS idx_workout_plans_user ON workout_plans(user_id);

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
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_date ON workout_sessions(user_id, session_date DESC);

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
);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_session ON workout_exercises(workout_session_id);

CREATE TABLE IF NOT EXISTS progress_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  weight_kg NUMERIC(6,2),
  body_fat_pct NUMERIC(5,2),
  notes TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_progress_logs_user_date ON progress_logs(user_id, log_date DESC);
