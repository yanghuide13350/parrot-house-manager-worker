ALTER TABLE feeding_plans ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1));
CREATE INDEX feeding_plans_enabled_match ON feeding_plans(owner_open_id, is_enabled, species, age_from_months, age_from_days, age_to_months, age_to_days);
