CREATE TABLE feeding_plans (
  id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  name TEXT NOT NULL,
  species TEXT NOT NULL,
  stage TEXT NOT NULL,
  age_from_months INTEGER NOT NULL CHECK (age_from_months >= 0),
  age_to_months INTEGER NOT NULL CHECK (age_to_months >= age_from_months),
  formula_name TEXT NOT NULL DEFAULT '',
  water_ml INTEGER NOT NULL DEFAULT 0 CHECK (water_ml >= 0),
  powder_scoops TEXT NOT NULL DEFAULT '',
  temperature_min INTEGER NOT NULL DEFAULT 0 CHECK (temperature_min >= 0),
  temperature_max INTEGER NOT NULL DEFAULT 0 CHECK (temperature_max >= temperature_min),
  feedings_per_day INTEGER NOT NULL DEFAULT 0 CHECK (feedings_per_day >= 0),
  amount_ml TEXT NOT NULL DEFAULT '',
  feeding_method TEXT NOT NULL DEFAULT '',
  temperature_check TEXT NOT NULL DEFAULT '',
  preparation_notes TEXT NOT NULL DEFAULT '',
  feeding_notes TEXT NOT NULL DEFAULT '',
  fullness_notes TEXT NOT NULL DEFAULT '',
  warning_notes TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX feeding_plans_owner_active ON feeding_plans(owner_open_id, deleted_at, species, age_from_months);

ALTER TABLE parrots ADD COLUMN feeding_plan_id TEXT;
CREATE INDEX parrots_owner_feeding_plan ON parrots(owner_open_id, feeding_plan_id, deleted_at);
