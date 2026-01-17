CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_id INTEGER,
  post_slug TEXT NOT NULL,
  parent_id INTEGER,
  legacy_parent_id INTEGER,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_website TEXT,
  author_ip TEXT,
  user_agent TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_slug, status, created_at);

CREATE INDEX IF NOT EXISTS idx_comments_legacy ON comments (legacy_id);
