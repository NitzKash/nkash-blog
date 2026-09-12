-- Everyone who has ever signed in.
--
-- Signing in is not the same as being allowed in. A first sign-in records a
-- row with status 'pending', which grants nothing beyond what an anonymous
-- visitor already sees — it exists so there is something to approve, and so
-- the person gets told they are waiting rather than silently seeing no change.
--
-- This sits alongside the OWNERS and CIRCLE environment variables rather than
-- replacing them. Those are the bootstrap: an owner can always get in even if
-- this table is empty, unreachable, or wrong.

CREATE TABLE IF NOT EXISTS members (
  -- The provider subject, e.g. 'github:12345' or 'google:1078…'. Stable across
  -- a login or email change, which neither of those two are.
  id            TEXT PRIMARY KEY,

  provider      TEXT NOT NULL,
  login         TEXT,
  email         TEXT,
  name          TEXT,
  avatar        TEXT,

  -- 'pending'  — signed in, waiting on a decision. Sees public only.
  -- 'approved' — circle tier.
  -- 'blocked'  — explicitly refused; kept as a row so a repeat sign-in does
  --              not silently reappear in the pending queue.
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'blocked')),

  requested_at  TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  decided_at    TEXT,
  decided_by    TEXT,
  note          TEXT
);

-- The approval queue is "pending, oldest first"; the per-request lookup is by
-- primary key and needs no index of its own.
CREATE INDEX IF NOT EXISTS idx_members_queue
  ON members (status, requested_at);
