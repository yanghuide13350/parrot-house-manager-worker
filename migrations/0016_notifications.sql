CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  owner_open_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX notifications_owner_created ON notifications(owner_open_id, created_at DESC);
CREATE INDEX notifications_owner_unread ON notifications(owner_open_id, read_at, created_at DESC);
