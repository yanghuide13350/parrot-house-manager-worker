-- Preserve the broader breed alongside the existing specific-name snapshot.
ALTER TABLE sales_records ADD COLUMN breed TEXT NOT NULL DEFAULT '';
CREATE INDEX sales_owner_breed_active ON sales_records(owner_open_id, breed, deleted_at);
