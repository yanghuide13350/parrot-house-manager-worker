PRAGMA foreign_keys = ON;

CREATE TABLE parrots (
  id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  species TEXT NOT NULL,
  ring_number TEXT NOT NULL,
  ring_number_normalized TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('MALE','FEMALE','UNKNOWN')),
  status TEXT NOT NULL CHECK (status IN ('FOR_SALE','SOLD','RETURNED','BREEDER','PAIRED','INCUBATING')),
  birth_date TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  public_intro TEXT NOT NULL DEFAULT '',
  private_notes TEXT NOT NULL DEFAULT '',
  media_json TEXT NOT NULL DEFAULT '[]',
  active_pair_id TEXT,
  paired_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT
);
CREATE UNIQUE INDEX parrots_owner_ring_active_unique ON parrots(owner_open_id, ring_number_normalized) WHERE deleted_at IS NULL;
CREATE INDEX parrots_owner_status_active ON parrots(owner_open_id, status, deleted_at);

CREATE TABLE breeding_pairs (
  id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  male_id TEXT NOT NULL,
  female_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','INCUBATING','CLOSED')),
  paired_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (male_id) REFERENCES parrots(id),
  FOREIGN KEY (female_id) REFERENCES parrots(id)
);
CREATE INDEX breeding_pairs_owner_status ON breeding_pairs(owner_open_id, status, deleted_at);

CREATE TABLE hatching_records (
  id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  pair_id TEXT NOT NULL,
  male_id TEXT NOT NULL,
  female_id TEXT NOT NULL,
  male_ring_number TEXT NOT NULL,
  female_ring_number TEXT NOT NULL,
  species TEXT NOT NULL,
  start_date TEXT NOT NULL,
  eggs INTEGER NOT NULL CHECK (eggs BETWEEN 1 AND 100),
  hatched INTEGER NOT NULL DEFAULT 0 CHECK (hatched >= 0),
  status TEXT NOT NULL CHECK (status IN ('INCUBATING','COMPLETED','CANCELLED')),
  completed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  FOREIGN KEY (pair_id) REFERENCES breeding_pairs(id)
);
CREATE INDEX hatching_owner_status ON hatching_records(owner_open_id, status, deleted_at);

CREATE TABLE sales_records (
  id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  parrot_id TEXT NOT NULL,
  species TEXT NOT NULL,
  ring_number TEXT NOT NULL,
  gender TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  media_json TEXT NOT NULL DEFAULT '[]',
  buyer TEXT NOT NULL,
  buyer_contact TEXT NOT NULL DEFAULT '',
  sale_date TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  status TEXT NOT NULL CHECK (status IN ('COMPLETED','RETURNED')),
  return_reason TEXT NOT NULL DEFAULT '',
  returned_at TEXT,
  follow_up_status TEXT NOT NULL CHECK (follow_up_status IN ('WAITING','VISITED','UNREACHABLE')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (parrot_id) REFERENCES parrots(id)
);
CREATE INDEX sales_owner_date ON sales_records(owner_open_id, deleted_at, sale_date DESC);

CREATE TABLE share_tokens (
  token_hash TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  parrot_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX share_owner_parrot_active ON share_tokens(owner_open_id, parrot_id, revoked_at, deleted_at);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('image','video')),
  size INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  upload_id TEXT,
  mime TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','COMMITTED','ORPHANED')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT
);
CREATE INDEX media_owner_status ON media_assets(owner_open_id, status, deleted_at);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_owner_time ON audit_logs(owner_open_id, created_at DESC);

CREATE TABLE command_receipts (
  receipt_id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
