-- CodeAtlas database schema (SQLite)
--
-- Applied automatically on server startup by db/client.js - there's no
-- separate migration step to run by hand. Every statement is
-- IF NOT EXISTS, so re-starting the server never re-runs or breaks
-- anything on an existing database file.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  username      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per distinct GitHub repository ever scanned. scans holds the
-- full history of audits run against it, which is what powers the
-- health-score trend line in the dashboard.
CREATE TABLE IF NOT EXISTS repositories (
  id                TEXT PRIMARY KEY,
  owner             TEXT NOT NULL,
  name              TEXT NOT NULL,
  full_name         TEXT NOT NULL UNIQUE, -- "owner/name"
  html_url          TEXT,
  description       TEXT,
  primary_language  TEXT,
  first_scanned_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_scanned_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_repositories_owner ON repositories(owner);

CREATE TABLE IF NOT EXISTS scans (
  id              TEXT PRIMARY KEY,
  repository_id   TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,

  commit_sha      TEXT,
  files_scanned   INTEGER NOT NULL DEFAULT 0,

  health_score    INTEGER NOT NULL,
  health_grade    TEXT NOT NULL,

  -- JSON-encoded arrays, stored as text. SQLite has no native array
  -- type, and keeping them as plain JSON strings means this same
  -- shape would drop into a Postgres TEXT/JSONB column unchanged.
  languages       TEXT NOT NULL DEFAULT '[]',
  frameworks      TEXT NOT NULL DEFAULT '[]',
  strengths       TEXT NOT NULL DEFAULT '[]',
  warnings        TEXT NOT NULL DEFAULT '[]',

  basic_summary   TEXT,
  business_logic  TEXT,
  ast_target_file TEXT,
  ast_tree        TEXT, -- JSON-encoded AST for the largest source file

  -- JSON-encoded arrays (see the `languages`/`frameworks` note above).
  -- scanned_files: relative file paths the scan actually walked.
  -- classes/functions: [{name, file}, ...] structural symbols found,
  -- each tagged with the file it was defined in.
  scanned_files   TEXT NOT NULL DEFAULT '[]',
  classes         TEXT NOT NULL DEFAULT '[]',
  functions       TEXT NOT NULL DEFAULT '[]',

  -- JSON-encoded objects (repo structure feature). repo_tree: nested
  -- parent/child folder+file tree with counts, built locally from
  -- scanned_files. branches/commits/pull_requests/repo_metadata: fetched
  -- live from the GitHub API at scan time (see analyzer/repoInsights.js).
  repo_tree       TEXT,
  branches        TEXT,
  commits         TEXT,
  pull_requests   TEXT,
  repo_metadata   TEXT,

  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scans_repository_id ON scans(repository_id);
CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id);
CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at);

CREATE TABLE IF NOT EXISTS vulnerabilities (
  id       TEXT PRIMARY KEY,
  scan_id  TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  type     TEXT NOT NULL,
  severity TEXT NOT NULL,
  file     TEXT NOT NULL,
  line     TEXT,
  snippet  TEXT
);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_scan_id ON vulnerabilities(scan_id);

CREATE TABLE IF NOT EXISTS api_endpoints (
  id       TEXT PRIMARY KEY,
  scan_id  TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  method   TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  file     TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_scan_id ON api_endpoints(scan_id);

CREATE TABLE IF NOT EXISTS database_models (
  id         TEXT PRIMARY KEY,
  scan_id    TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  orm_type   TEXT NOT NULL,
  table_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_database_models_scan_id ON database_models(scan_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  scan_id    TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  role       TEXT NOT NULL, -- 'user' | 'assistant'
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_scan_id ON chat_messages(scan_id);
