ALTER TABLE parrots ADD COLUMN record_source TEXT NOT NULL DEFAULT 'PROFILE' CHECK (record_source IN ('PROFILE','INTRODUCTION'));
ALTER TABLE parrots ADD COLUMN purchase_date TEXT;
ALTER TABLE parrots ADD COLUMN introduction_stage TEXT CHECK (introduction_stage IN ('GROWING','FOR_SALE'));

CREATE INDEX parrots_owner_source_purchase ON parrots(owner_open_id, record_source, purchase_date DESC, deleted_at);
