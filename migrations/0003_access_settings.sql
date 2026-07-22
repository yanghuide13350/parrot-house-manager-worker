CREATE TABLE access_settings (
  owner_open_id TEXT PRIMARY KEY,
  open_access INTEGER NOT NULL DEFAULT 0 CHECK (open_access IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
