CREATE TABLE sale_copy_documents (
  id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  parrot_id TEXT NOT NULL,
  generation_token TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','PROCESSING','READY','FAILED')),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  expires_at TEXT,
  viewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parrot_id) REFERENCES parrots(id)
);
CREATE UNIQUE INDEX sale_copy_documents_owner_parrot_unique ON sale_copy_documents(owner_open_id, parrot_id);
CREATE INDEX sale_copy_documents_expiry ON sale_copy_documents(expires_at);
