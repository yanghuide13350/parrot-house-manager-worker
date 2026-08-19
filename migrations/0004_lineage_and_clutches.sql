ALTER TABLE parrots ADD COLUMN father_id TEXT;
ALTER TABLE parrots ADD COLUMN father_snapshot_json TEXT NOT NULL DEFAULT '';
ALTER TABLE parrots ADD COLUMN mother_id TEXT;
ALTER TABLE parrots ADD COLUMN mother_snapshot_json TEXT NOT NULL DEFAULT '';
CREATE INDEX parrots_owner_father_active ON parrots(owner_open_id, father_id, deleted_at);
CREATE INDEX parrots_owner_mother_active ON parrots(owner_open_id, mother_id, deleted_at);

-- A clutch can contain more than one variety, so the actual hatch result is
-- stored separately from the expected species recorded when incubation starts.
ALTER TABLE hatching_records ADD COLUMN offspring_json TEXT NOT NULL DEFAULT '[]';
