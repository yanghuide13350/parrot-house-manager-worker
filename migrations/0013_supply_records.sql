CREATE TABLE supply_records (
  id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('SUPPLY', 'MEDICINE')),
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  weight TEXT NOT NULL DEFAULT '',
  purchase_date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX supply_records_owner_date ON supply_records(owner_open_id, category, purchase_date DESC, created_at DESC);
