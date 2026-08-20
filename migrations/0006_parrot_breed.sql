-- `species` stores the bird's specific name (for example, 黄化玄凤).
-- `breed` stores its broader breed (for example, 玄凤). Existing records are
-- deliberately left blank rather than guessed from their historical name.
ALTER TABLE parrots ADD COLUMN breed TEXT NOT NULL DEFAULT '';
CREATE INDEX parrots_owner_breed_active ON parrots(owner_open_id, breed, deleted_at);
