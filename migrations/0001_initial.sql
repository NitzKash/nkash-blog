-- Posts and their rendered output.
--
-- `html` is rendered at publish time rather than per request: the free plan
-- allows 10ms of CPU per request, and parsing markdown on every page view
-- spends it to produce a byte-identical result. `body` keeps the markdown
-- source so everything can be re-rendered in bulk if the pipeline changes.

CREATE TABLE IF NOT EXISTS posts (
  slug             TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',

  -- 'public' | 'circle' | 'private'. Defaults to private so a row inserted
  -- without one fails closed, matching the frontmatter schema.
  visibility       TEXT NOT NULL DEFAULT 'private'
                     CHECK (visibility IN ('public', 'circle', 'private')),
  draft            INTEGER NOT NULL DEFAULT 0 CHECK (draft IN (0, 1)),

  -- ISO-8601 UTC. SQLite has no date type; storing ISO strings keeps
  -- lexicographic order identical to chronological order, so ORDER BY works
  -- without parsing.
  pub_date         TEXT NOT NULL,
  updated_date     TEXT,

  tags             TEXT NOT NULL DEFAULT '[]',   -- JSON array
  allow            TEXT NOT NULL DEFAULT '[]',   -- JSON array of per-post grants

  body             TEXT NOT NULL DEFAULT '',     -- markdown source
  html             TEXT NOT NULL DEFAULT '',     -- rendered at publish time
  reading_minutes  INTEGER NOT NULL DEFAULT 1,

  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- D1 charges for rows *examined*, not rows returned, so the listing query must
-- not scan. This covers the common path: public posts, newest first.
CREATE INDEX IF NOT EXISTS idx_posts_listing
  ON posts (visibility, draft, pub_date DESC);

-- Projects shown on /projects.
CREATE TABLE IF NOT EXISTS projects (
  slug         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'building'
                 CHECK (status IN ('live', 'building', 'archived')),
  demo_url     TEXT,
  repo_url     TEXT,
  stack        TEXT NOT NULL DEFAULT '[]',   -- JSON array
  visibility   TEXT NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('public', 'circle', 'private')),
  allow        TEXT NOT NULL DEFAULT '[]',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_listing
  ON projects (visibility, sort_order);

-- Objects held in R2, indexed here so they can be listed and attributed
-- without paying for an R2 LIST on every request.
CREATE TABLE IF NOT EXISTS assets (
  key          TEXT PRIMARY KEY,   -- the R2 object key
  post_slug    TEXT REFERENCES posts (slug) ON DELETE SET NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  -- Assets inherit the visibility of the post they belong to; a standalone
  -- asset defaults to private for the same fail-closed reason as posts.
  visibility   TEXT NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('public', 'circle', 'private')),
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_post ON assets (post_slug);
