ALTER TABLE feeding_plans ADD COLUMN feeding_type TEXT NOT NULL DEFAULT 'FORMULA' CHECK (feeding_type IN ('FORMULA','MIXED','SOLID'));
ALTER TABLE feeding_plans ADD COLUMN seed_food_name TEXT NOT NULL DEFAULT '';
ALTER TABLE feeding_plans ADD COLUMN seed_food_amount TEXT NOT NULL DEFAULT '';
ALTER TABLE feeding_plans ADD COLUMN seed_food_notes TEXT NOT NULL DEFAULT '';
