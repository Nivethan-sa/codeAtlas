const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "codeatlas.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// node:sqlite ships inside Node itself (stable enough for this since Node 22.5) -
// unlike better-sqlite3, there's no native addon to compile, so this never hits
// node-gyp/Visual Studio/prebuilt-binary-availability issues on any platform.
// The one visible side effect is a one-line "SQLite is an experimental feature"
// warning on startup - harmless, just Node being honest about the API's status.
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

// `CREATE TABLE IF NOT EXISTS` in schema.sql only creates the table on a
// fresh database - it does nothing for a `scans` table that already exists
// from before these columns were added. Patch them in by hand so upgrading
// doesn't require deleting the existing database file.
const scanColumns = db.prepare("PRAGMA table_info(scans)").all().map((c) => c.name);
const scanColumnMigrations = [
  ["scanned_files", "TEXT NOT NULL DEFAULT '[]'"],
  ["classes", "TEXT NOT NULL DEFAULT '[]'"],
  ["functions", "TEXT NOT NULL DEFAULT '[]'"],
  ["repo_tree", "TEXT"],
  ["branches", "TEXT"],
  ["commits", "TEXT"],
  ["pull_requests", "TEXT"],
  ["repo_metadata", "TEXT"],
];
for (const [column, definition] of scanColumnMigrations) {
  if (!scanColumns.includes(column)) {
    db.exec(`ALTER TABLE scans ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = db;
