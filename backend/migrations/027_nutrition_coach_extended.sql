-- Extended nutrition profile + food images.
-- Idempotent. Applied via ensureNutritionCoachExtendedColumns() on boot.

ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS waist_cm NUMERIC(6,2);
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS job_activity_level VARCHAR(30);
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS sleep_hours NUMERIC(4,1);
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS usual_meal_timing JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS gym_experience VARCHAR(30);
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS available_gym_days JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS workout_goal VARCHAR(30);
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS injuries_pain_areas TEXT;
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS medical_caution_notes TEXT;
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS supplement_usage TEXT;
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS daily_water_baseline_ml NUMERIC(10,2);
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS caffeine_intake VARCHAR(40);
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS digestion_probiotic_habits TEXT;
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS budget_level VARCHAR(30);
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS preferred_foods TEXT;
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE nutrition_profiles ADD COLUMN IF NOT EXISTS onboarding_step SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE food_library ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS image_key TEXT;

CREATE INDEX IF NOT EXISTS idx_food_library_image_key ON food_library(image_key);
