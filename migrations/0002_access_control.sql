CREATE TABLE access_grants (
  id TEXT PRIMARY KEY,
  open_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','MEMBER')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
);
CREATE INDEX access_grants_status ON access_grants(status);
CREATE INDEX access_grants_role_status ON access_grants(role, status);

CREATE TABLE access_requests (
  id TEXT PRIMARY KEY,
  open_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX access_requests_open_id_status ON access_requests(open_id, status, requested_at);
CREATE INDEX access_requests_status_requested ON access_requests(status, requested_at);
