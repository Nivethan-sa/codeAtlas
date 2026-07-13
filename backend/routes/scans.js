const express = require("express");
const db = require("../db/queries");
const { optionalAuth, requireAuth } = require("../middleware/auth");

const router = express.Router();

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/** Reshapes a hydrated DB scan back into the same {repository,
 * description, health_audit, analysis} envelope /api/analyze returns,
 * so the frontend can feed a historical scan through the exact same
 * rendering code path as a brand-new one. */
function toAnalyzePayload(scan) {
  return {
    repository: scan.repository.fullName,
    description: scan.repository.description || "No description provided",
    scan_id: scan.id,
    commit_sha: scan.commitSha,
    scanned_at: scan.createdAt,
    health_audit: {
      score: scan.healthScore,
      grade: scan.healthGrade,
      strengths: safeParse(scan.strengths, []),
      warnings: safeParse(scan.warnings, []),
    },
    analysis: {
      files: scan.filesScanned,
      scanned_files: safeParse(scan.scannedFiles, []),
      scanned_files_truncated: false,
      languages: safeParse(scan.languages, []),
      frameworks: safeParse(scan.frameworks, []),
      database_tables: scan.databaseModels.map((m) => ({
        database_type: m.ormType,
        table_name: m.tableName,
      })),
      api_endpoints: scan.apiEndpoints.map((e) => ({
        method: e.method,
        endpoint: e.endpoint,
        file: e.file,
      })),
      security_vulnerabilities: scan.vulnerabilities.map((v) => ({
        type: v.type,
        severity: v.severity,
        file: v.file,
        line: v.line,
        snippet: v.snippet,
      })),
      ast_structure: scan.astTree
        ? { target_file: scan.astTargetFile, tree: safeParse(scan.astTree, null) }
        : null,
      repo_tree: safeParse(scan.repoTree, null),
      branches: safeParse(scan.branches, { available: false, branches: [], total_branches: 0 }),
      commits: safeParse(scan.commits, { available: false, total_commits: 0, recent: [] }),
      pull_requests: safeParse(scan.pullRequests, {
        available: false,
        counts: { open: 0, closed: 0, merged: 0 },
        pull_requests: [],
      }),
      repo_metadata: safeParse(scan.repoMetadata, { available: false }),
      architecture_symbols: {
        total_classes: safeParse(scan.classes, []).length,
        total_functions: safeParse(scan.functions, []).length,
        classes: safeParse(scan.classes, []),
        functions: safeParse(scan.functions, []),
      },
      basic_summary: scan.basicSummary || "N/A",
      business_logic: scan.businessLogic || "N/A",
    },
  };
}

// --- GET /api/scans -------------------------------------------------
// scope=mine (requires auth) | public (default) - a lightweight feed
// of recent scans for the History tab.
router.get("/", optionalAuth, (req, res) => {
  try {
    const scope = req.query.scope === "mine" ? "mine" : "public";
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    if (scope === "mine" && !req.user) {
      return res.status(401).json({ error: "Log in to view your scan history." });
    }

    const scans = db.listScans({ scope, userId: req.user?.id, limit });
    res.json({ scope, count: scans.length, scans });
  } catch (error) {
    console.error("❌ Scan history error:", error.message);
    res.status(500).json({ error: "Failed to load scan history." });
  }
});

// --- GET /api/scans/:id ----------------------------------------------
router.get("/:id", (req, res) => {
  try {
    const scan = db.findScanById(req.params.id);
    if (!scan) return res.status(404).json({ error: "Scan not found." });
    res.json(toAnalyzePayload(scan));
  } catch (error) {
    console.error("❌ Scan detail error:", error.message);
    res.status(500).json({ error: "Failed to load scan." });
  }
});

// --- DELETE /api/scans/:id ---------------------------------------------
// Only the scan's owner can delete it; anonymous scans can't be deleted
// through the API at all (nobody owns them).
router.delete("/:id", requireAuth, (req, res) => {
  try {
    const scan = db.findScanById(req.params.id);
    if (!scan) return res.status(404).json({ error: "Scan not found." });
    if (scan.userId !== req.user.id) {
      return res.status(403).json({ error: "You don't own this scan." });
    }

    db.deleteScan(req.params.id);
    res.json({ deleted: true });
  } catch (error) {
    console.error("❌ Scan delete error:", error.message);
    res.status(500).json({ error: "Failed to delete scan." });
  }
});

module.exports = { router, toAnalyzePayload };
