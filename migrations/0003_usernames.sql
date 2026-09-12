-- A chosen handle, separate from the provider identity.
--
-- Signing in hands over a GitHub login or a Google email address, neither of
-- which a reader necessarily wants attached to what they read here. The handle
-- is what gets displayed instead; the provider identity stays in the columns
-- above it and is only ever seen by an owner deciding whether to approve
-- someone.
--
-- Nullable: choosing one is offered, not required. A member without a handle
-- falls back to their login, which is the status quo.

ALTER TABLE members ADD COLUMN username TEXT;

-- Case-insensitive uniqueness. SQLite has no citext, so the index is on the
-- lowercased value and every lookup lowercases to match.
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_username
  ON members (lower(username)) WHERE username IS NOT NULL;
