const crypto = require("crypto");
const db = require("./client");

function newId() {
  return crypto.randomUUID();
}

// SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC but
// without a timezone marker, which JS's Date constructor can parse
// inconsistently across environments. Normalizing to real ISO-8601
// makes every timestamp we hand back behave like a real Date.
function toDate(sqliteTimestamp) {
  return sqliteTimestamp ? new Date(sqliteTimestamp.replace(" ", "T") + "Z") : null;
}

// --- Row -> JS object mappers -------------------------------------------

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    username: row.username,
    createdAt: toDate(row.created_at),
  };
}

function mapRepository(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    htmlUrl: row.html_url,
    description: row.description,
    primaryLanguage: row.primary_language,
    firstScannedAt: toDate(row.first_scanned_at),
    lastScannedAt: toDate(row.last_scanned_at),
  };
}

function mapVulnerability(row) {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    file: row.file,
    line: row.line,
    snippet: row.snippet,
  };
}

function mapApiEndpoint(row) {
  return { id: row.id, method: row.method, endpoint: row.endpoint, file: row.file };
}

function mapDatabaseModel(row) {
  return { id: row.id, ormType: row.orm_type, tableName: row.table_name };
}

function mapScanRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    repositoryId: row.repository_id,
    userId: row.user_id,
    commitSha: row.commit_sha,
    filesScanned: row.files_scanned,
    healthScore: row.health_score,
    healthGrade: row.health_grade,
    languages: row.languages,
    frameworks: row.frameworks,
    strengths: row.strengths,
    warnings: row.warnings,
    basicSummary: row.basic_summary,
    businessLogic: row.business_logic,
    astTargetFile: row.ast_target_file,
    astTree: row.ast_tree,
    scannedFiles: row.scanned_files,
    classes: row.classes,
    functions: row.functions,
    repoTree: row.repo_tree,
    branches: row.branches,
    commits: row.commits,
    pullRequests: row.pull_requests,
    repoMetadata: row.repo_metadata,
    createdAt: toDate(row.created_at),
  };
}

/** Attaches repository + child rows to a bare scan row, mirroring the
 * shape server.js/routes expect (this used to be Prisma's `include`). */
function hydrateScan(scanRow) {
  if (!scanRow) return null;
  const scan = mapScanRow(scanRow);

  scan.repository = mapRepository(
    db.prepare("SELECT * FROM repositories WHERE id = ?").get(scanRow.repository_id),
  );
  scan.vulnerabilities = db
    .prepare("SELECT * FROM vulnerabilities WHERE scan_id = ?")
    .all(scan.id)
    .map(mapVulnerability);
  scan.apiEndpoints = db
    .prepare("SELECT * FROM api_endpoints WHERE scan_id = ?")
    .all(scan.id)
    .map(mapApiEndpoint);
  scan.databaseModels = db
    .prepare("SELECT * FROM database_models WHERE scan_id = ?")
    .all(scan.id)
    .map(mapDatabaseModel);

  return scan;
}

// --- Users ---------------------------------------------------------------

function createUser({ email, passwordHash, username }) {
  const id = newId();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, username) VALUES (?, ?, ?, ?)",
  ).run(id, email, passwordHash, username || null);
  return mapUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

function findUserByEmail(email) {
  return mapUser(db.prepare("SELECT * FROM users WHERE email = ?").get(email));
}

function findUserById(id) {
  return mapUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

// --- Repositories ----------------------------------------------------------

function upsertRepository({ owner, name, fullName, htmlUrl, description, primaryLanguage }) {
  const existing = db.prepare("SELECT * FROM repositories WHERE full_name = ?").get(fullName);

  if (existing) {
    db.prepare(
      `UPDATE repositories
         SET description = ?, primary_language = ?, last_scanned_at = datetime('now')
       WHERE id = ?`,
    ).run(description || null, primaryLanguage || null, existing.id);
    return mapRepository(db.prepare("SELECT * FROM repositories WHERE id = ?").get(existing.id));
  }

  const id = newId();
  db.prepare(
    `INSERT INTO repositories (id, owner, name, full_name, html_url, description, primary_language)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, owner, name, fullName, htmlUrl || null, description || null, primaryLanguage || null);
  return mapRepository(db.prepare("SELECT * FROM repositories WHERE id = ?").get(id));
}

function findRepositoryByFullName(fullName) {
  return mapRepository(db.prepare("SELECT * FROM repositories WHERE full_name = ?").get(fullName));
}

// --- Scans -----------------------------------------------------------------

// node:sqlite has no db.transaction(fn) helper (that's a better-sqlite3-only
// convenience), so the same atomicity is done by hand: BEGIN, do the inserts,
// COMMIT - and ROLLBACK if anything throws, so a scan with 40 vulnerabilities
// never ends up half-written.
function insertScanTxn(scan) {
  const id = newId();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO scans (
         id, repository_id, user_id, commit_sha, files_scanned,
         health_score, health_grade, languages, frameworks, strengths, warnings,
         basic_summary, business_logic, ast_target_file, ast_tree,
         scanned_files, classes, functions,
         repo_tree, branches, commits, pull_requests, repo_metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      scan.repositoryId,
      scan.userId || null,
      scan.commitSha || null,
      scan.filesScanned || 0,
      scan.healthScore,
      scan.healthGrade,
      scan.languages,
      scan.frameworks,
      scan.strengths,
      scan.warnings,
      scan.basicSummary || null,
      scan.businessLogic || null,
      scan.astTargetFile || null,
      scan.astTree || null,
      scan.scannedFiles || "[]",
      scan.classes || "[]",
      scan.functions || "[]",
      scan.repoTree || null,
      scan.branches || null,
      scan.commits || null,
      scan.pullRequests || null,
      scan.repoMetadata || null,
    );

    const insertVuln = db.prepare(
      "INSERT INTO vulnerabilities (id, scan_id, type, severity, file, line, snippet) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const v of scan.vulnerabilities || []) {
      insertVuln.run(newId(), id, v.type, v.severity, v.file, String(v.line), v.snippet);
    }

    const insertEndpoint = db.prepare(
      "INSERT INTO api_endpoints (id, scan_id, method, endpoint, file) VALUES (?, ?, ?, ?, ?)",
    );
    for (const e of scan.apiEndpoints || []) {
      insertEndpoint.run(newId(), id, e.method, e.endpoint, e.file);
    }

    const insertModel = db.prepare(
      "INSERT INTO database_models (id, scan_id, orm_type, table_name) VALUES (?, ?, ?, ?)",
    );
    for (const m of scan.databaseModels || []) {
      insertModel.run(newId(), id, m.ormType, m.tableName);
    }

    db.exec("COMMIT");
    return id;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function createScan(scan) {
  const id = insertScanTxn(scan);
  return hydrateScan(db.prepare("SELECT * FROM scans WHERE id = ?").get(id));
}

function findScanById(id) {
  return hydrateScan(db.prepare("SELECT * FROM scans WHERE id = ?").get(id));
}

function findLatestScanForRepository(fullName) {
  const row = db
    .prepare(
      `SELECT scans.* FROM scans
       JOIN repositories ON repositories.id = scans.repository_id
       WHERE repositories.full_name = ?
       ORDER BY scans.created_at DESC
       LIMIT 1`,
    )
    .get(fullName);
  return hydrateScan(row);
}

function listScans({ scope, userId, limit }) {
  const rows =
    scope === "mine"
      ? db
          .prepare(
            `SELECT scans.*, repositories.full_name AS repo_full_name, repositories.html_url AS repo_html_url
             FROM scans
             JOIN repositories ON repositories.id = scans.repository_id
             WHERE scans.user_id = ?
             ORDER BY scans.created_at DESC
             LIMIT ?`,
          )
          .all(userId, limit)
      : db
          .prepare(
            `SELECT scans.*, repositories.full_name AS repo_full_name, repositories.html_url AS repo_html_url
             FROM scans
             JOIN repositories ON repositories.id = scans.repository_id
             ORDER BY scans.created_at DESC
             LIMIT ?`,
          )
          .all(limit);

  return rows.map((row) => ({
    id: row.id,
    repository: row.repo_full_name,
    htmlUrl: row.repo_html_url,
    healthScore: row.health_score,
    healthGrade: row.health_grade,
    filesScanned: row.files_scanned,
    createdAt: toDate(row.created_at),
  }));
}

function deleteScan(id) {
  db.prepare("DELETE FROM scans WHERE id = ?").run(id);
}

function findScanHistoryForRepository(fullName) {
  return db
    .prepare(
      `SELECT scans.id, scans.health_score, scans.health_grade, scans.commit_sha, scans.created_at
       FROM scans
       JOIN repositories ON repositories.id = scans.repository_id
       WHERE repositories.full_name = ?
       ORDER BY scans.created_at ASC`,
    )
    .all(fullName)
    .map((row) => ({
      id: row.id,
      healthScore: row.health_score,
      healthGrade: row.health_grade,
      commitSha: row.commit_sha,
      createdAt: toDate(row.created_at),
    }));
}

// --- Chat messages -----------------------------------------------------------

function createChatMessage({ scanId, userId, role, content }) {
  db.prepare(
    "INSERT INTO chat_messages (id, scan_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)",
  ).run(newId(), scanId, userId || null, role, content);
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  upsertRepository,
  findRepositoryByFullName,
  createScan,
  findScanById,
  findLatestScanForRepository,
  listScans,
  deleteScan,
  findScanHistoryForRepository,
  createChatMessage,
};
