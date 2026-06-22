-- World diet metadata on global food library
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS origin_region TEXT;
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS diet_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS nutrient_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS caution_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE food_library ADD COLUMN IF NOT EXISTS why_recommended TEXT;

CREATE INDEX IF NOT EXISTS idx_food_library_origin_region ON food_library(origin_region);
CREATE INDEX IF NOT EXISTS idx_food_library_diet_tags ON food_library USING GIN (diet_tags);
CREATE INDEX IF NOT EXISTS idx_food_library_nutrient_tags ON food_library USING GIN (nutrient_tags);
