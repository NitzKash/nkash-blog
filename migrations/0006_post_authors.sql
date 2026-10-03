-- Posts gain an author.
--
-- Until now every post was implicitly the site owner's, and the tiers were
-- defined relative to them: `private` meant "owners only". With more than one
-- author that definition breaks — a contributor's private post would be
-- readable by the owner and not by the person who wrote it.
--
-- So `private` now means **only the author**. The owner is not special for
-- someone else's private post; `/posts/<slug>` returns the same 404 it gives
-- anyone. The operator can still read the row from the database, which is true
-- of every hosted system and is stated plainly in the README rather than
-- pretended away.
--
-- NULL means the site owner. Backfilling a real id here would mean writing a
-- provider subject into a migration that lives in a public repository, so the
-- absence of a value carries that meaning instead, and `canView` treats it as
-- owner-authored.

ALTER TABLE posts ADD COLUMN author_id TEXT;

-- The listing query filters on visibility and draft, and now also has to match
-- the viewer's own posts. Covering the author on the same index keeps that a
-- lookup rather than a scan — D1 bills rows examined.
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts (author_id, pub_date DESC);
