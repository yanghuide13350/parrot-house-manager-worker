ALTER TABLE sale_copy_documents RENAME TO sale_copy_documents_previous;

CREATE TABLE sale_copy_documents (
  id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  parrot_id TEXT NOT NULL,
  generation_token TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','STREAMING','PROCESSING','READY','FAILED')),
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

INSERT INTO sale_copy_documents (id,owner_open_id,parrot_id,generation_token,request_json,status,title,content,error_message,completed_at,expires_at,viewed_at,created_at,updated_at)
SELECT id,owner_open_id,parrot_id,generation_token,request_json,status,title,content,error_message,completed_at,expires_at,viewed_at,created_at,updated_at
FROM sale_copy_documents_previous;

DROP TABLE sale_copy_documents_previous;

CREATE UNIQUE INDEX sale_copy_documents_owner_parrot_unique ON sale_copy_documents(owner_open_id, parrot_id);
CREATE INDEX sale_copy_documents_expiry ON sale_copy_documents(expires_at);
