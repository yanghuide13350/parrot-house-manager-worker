ALTER TABLE feeding_plans ADD COLUMN age_from_days INTEGER NOT NULL DEFAULT 0 CHECK (age_from_days >= 0 AND age_from_days <= 30);
ALTER TABLE feeding_plans ADD COLUMN age_to_days INTEGER NOT NULL DEFAULT 0 CHECK (age_to_days >= 0 AND age_to_days <= 30);
