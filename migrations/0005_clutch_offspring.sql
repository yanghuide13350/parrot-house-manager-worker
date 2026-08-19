-- Keep the source clutch on every chick created through the batch intake flow.
ALTER TABLE parrots ADD COLUMN birth_hatching_record_id TEXT;

-- Ring numbers are optional for newly hatched chicks. Blank ring numbers must
-- not participate in the uniqueness constraint, while non-blank values stay
-- unique within an owner's active archive.
DROP INDEX parrots_owner_ring_active_unique;
CREATE UNIQUE INDEX parrots_owner_ring_active_unique
  ON parrots(owner_open_id, ring_number_normalized)
  WHERE deleted_at IS NULL AND ring_number_normalized <> '';

CREATE INDEX parrots_owner_birth_hatching_active
  ON parrots(owner_open_id, birth_hatching_record_id, deleted_at);
