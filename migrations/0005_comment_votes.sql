-- Votes on comments.
--
-- Only a total is ever displayed — never who voted. But a per-member row is
-- still required underneath, because without one there is nothing stopping a
-- single person casting the same vote a hundred times. The composite primary
-- key is the whole enforcement mechanism: one row per member per comment, so
-- voting again replaces rather than accumulates.
--
-- Storing the individual votes also makes retracting one possible, which a
-- bare counter column could not do.

CREATE TABLE IF NOT EXISTS comment_votes (
  comment_id  TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  -- +1 or -1. No zero: retracting deletes the row rather than storing a
  -- neutral vote, so SUM() needs no special case.
  value       INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at  TEXT NOT NULL,

  PRIMARY KEY (comment_id, member_id)
);

-- The tally query: every vote on the comments of one post.
CREATE INDEX IF NOT EXISTS idx_votes_comment ON comment_votes (comment_id, value);
