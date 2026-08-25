-- Parrot deletions are recoverable for 15 days. The row's deleted_at value is
-- the authoritative expiry anchor; the scheduled Worker removes expired rows.
CREATE INDEX IF NOT EXISTS parrots_owner_recycle_bin ON parrots(owner_open_id, deleted_at DESC);

-- Historical rows remain NULL. New destructive actions record the real
-- authorized account, instead of only the shared workspace owner.
ALTER TABLE audit_logs ADD COLUMN actor_open_id TEXT;
CREATE INDEX IF NOT EXISTS audit_target_time ON audit_logs(target_type, target_id, created_at DESC);
