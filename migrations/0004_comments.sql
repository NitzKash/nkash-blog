-- Comments.
--
-- The first content on this site that is not written by an owner. Everything
-- else renders HTML the operator authored; these do not, which is why the
-- rendering path for them is separate and deliberately much narrower — see
-- lib/comment-markdown.ts.
--
-- Comments inherit the visibility of the post they hang off. There is no
-- visibility column: if canView() refuses the post, the reader never reaches
-- the thread. One authorisation decision, not two that can drift apart.

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,

  post_slug   TEXT NOT NULL,
  -- The provider subject from members.id. Not a foreign key with ON DELETE
  -- CASCADE on purpose: removing a member should not silently erase a
  -- conversation other people took part in.
  member_id   TEXT NOT NULL,

  body        TEXT NOT NULL,   -- source, as typed
  html        TEXT NOT NULL,   -- rendered once at write time, escape-first

  -- Moderation is a flag, not a delete, so a hidden comment can be restored
  -- and so the thread keeps its shape.
  hidden      INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),

  created_at  TEXT NOT NULL
);

-- The thread query: one post, visible only, oldest first.
CREATE INDEX IF NOT EXISTS idx_comments_thread
  ON comments (post_slug, hidden, created_at);

-- The rate-limit query: how many has this member posted recently.
CREATE INDEX IF NOT EXISTS idx_comments_rate
  ON comments (member_id, created_at);
