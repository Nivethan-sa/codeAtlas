const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
require("dotenv").config();

const analyzeRepository = require("./analyzer");
const { getRepoInsights } = require("./analyzer/repoInsights");
const askRepoChatbot = require("./analyzer/chatAgent");
const db = require("./db/queries");
const { optionalAuth } = require("./middleware/auth");
const { parseGithubRepoInput, isSafeGithubUsername } = require("./utils/validate");

const authRoutes = require("./routes/auth");
const { router: scanRoutes, toAnalyzePayload } = require("./routes/scans");
const repositoryRoutes = require("./routes/repositories");

if (!process.env.JWT_SECRET) {
  console.error(
    "❌ JWT_SECRET is not set. Copy backend/.env.example to backend/.env and set one before starting the server.",
  );
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5001;

// How long a repository's most recent scan is considered "fresh enough"
// to serve straight from the database instead of re-cloning and
// re-scanning. Pass ?force=true to bypass this.
const SCAN_CACHE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Serve the dashboard itself, so `npm start` gives you the whole app
// (frontend + API) on one origin/port - no second dev server, no CORS
// juggling. Visiting http://localhost:5001 loads frontend/index.html.
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Generous global limiter just to blunt casual abuse/scripted hammering.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// Cloning + scanning a repo is the expensive operation, so it gets its
// own tighter limiter on top of the global one.
const analyzeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many scans requested. Please wait a few minutes." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts. Please wait a few minutes." },
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/scans", scanRoutes);
app.use("/api/repositories", repositoryRoutes);

// In-memory cache so a burst of chat messages about the scan we *just*
// computed doesn't each round-trip to the DB. Falls back to a DB fetch
// (via toAnalyzePayload) when the entry isn't cached, e.g. after a
// restart or when chatting about a scan loaded from history.
const recentScanCache = new Map(); // scanId -> analyze payload
function cacheScan(scanId, payload) {
  recentScanCache.set(scanId, payload);
  if (recentScanCache.size > 200) {
    recentScanCache.delete(recentScanCache.keys().next().value);
  }
}

function readGithubToken() {
  return process.env.GITHUB_TOKEN
    ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
    : {};
}

// --- ROUTE: THE SCANNER -------------------------------------------------
app.get("/api/analyze", analyzeLimiter, optionalAuth, async (req, res) => {
  const rawInput = req.query.url;
  let tempFolder = "";

  if (!rawInput) {
    return res.status(400).json({ error: "Please provide a GitHub URL" });
  }

  const parsed = parseGithubRepoInput(rawInput);
  if (!parsed) {
    return res.status(400).json({
      error:
        "That doesn't look like a valid GitHub repository. Use a full URL (https://github.com/owner/repo) or owner/repo.",
    });
  }
  const { owner: username, repo: repoName } = parsed;
  const fullName = `${username}/${repoName}`;
  const force = req.query.force === "true";

  try {
    // --- Cache fast-path: served straight from the database ---------
    if (!force) {
      const lastScan = db.findLatestScanForRepository(fullName);
      if (lastScan && Date.now() - lastScan.createdAt.getTime() < SCAN_CACHE_WINDOW_MS) {
        const payload = toAnalyzePayload(lastScan);
        cacheScan(lastScan.id, payload);
        return res.status(200).json({ ...payload, cached: true });
      }
    }

    console.log(`\n1. Fetching metadata for ${username}/${repoName}...`);
    const githubApiUrl = `https://api.github.com/repos/${username}/${repoName}`;

    const response = await axios.get(githubApiUrl, {
      headers: { ...readGithubToken(), "User-Agent": "CodeAtlas-Analyzer" },
    });

    console.log(`2. Cloning repository locally...`);
    const cloneUrl = response.data.clone_url;
    tempFolder = path.join(__dirname, "temp_repos", `${username}__${repoName}__${Date.now()}`);

    fs.mkdirSync(path.dirname(tempFolder), { recursive: true });
    if (fs.existsSync(tempFolder)) {
      fs.rmSync(tempFolder, { recursive: true, force: true });
    }

    // execFileSync (no shell) instead of execSync(`...`) - arguments are
    // passed as a literal array, so nothing in cloneUrl/tempFolder can
    // break out into a second shell command.
    execFileSync("git", ["clone", "--depth", "1", cloneUrl, tempFolder], {
      stdio: "pipe",
    });

    let commitSha = null;
    try {
      commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: tempFolder,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      // Non-fatal - just means we won't be able to show which commit was audited.
    }

    console.log(`3. Analyzing repository...`);
    // Local file scan/AST/security work and the "living" GitHub-side data
    // (branches, commits, PRs, metadata) don't depend on each other, so
    // run them concurrently instead of back-to-back.
    const [analysisResult, repoInsights] = await Promise.all([
      analyzeRepository(tempFolder, repoName),
      getRepoInsights({
        owner: username,
        repo: repoName,
        headers: { ...readGithubToken(), "User-Agent": "CodeAtlas-Analyzer" },
        defaultBranch: response.data.default_branch,
        repoApiData: response.data,
      }),
    ]);
    analysisResult.analysis.branches = repoInsights.branches;
    analysisResult.analysis.commits = repoInsights.commits;
    analysisResult.analysis.pull_requests = repoInsights.pull_requests;
    analysisResult.analysis.repo_metadata = repoInsights.metadata;

    console.log(`4. Analysis complete. Persisting to database...`);

    const repository = db.upsertRepository({
      owner: username,
      name: repoName,
      fullName,
      htmlUrl: response.data.html_url,
      description: analysisResult.description,
      primaryLanguage: response.data.language || null,
    });

    const scan = db.createScan({
      repositoryId: repository.id,
      userId: req.user ? req.user.id : null,
      commitSha,
      filesScanned: analysisResult.analysis.files,
      healthScore: analysisResult.health_audit.score,
      healthGrade: analysisResult.health_audit.grade,
      languages: JSON.stringify(analysisResult.analysis.languages),
      frameworks: JSON.stringify(analysisResult.analysis.frameworks),
      strengths: JSON.stringify(analysisResult.health_audit.strengths),
      warnings: JSON.stringify(analysisResult.health_audit.warnings),
      basicSummary: analysisResult.analysis.basic_summary,
      businessLogic: analysisResult.analysis.business_logic,
      astTargetFile: analysisResult.analysis.ast_structure?.target_file || null,
      astTree: analysisResult.analysis.ast_structure?.tree
        ? JSON.stringify(analysisResult.analysis.ast_structure.tree)
        : null,
      scannedFiles: JSON.stringify(analysisResult.analysis.scanned_files || []),
      classes: JSON.stringify(analysisResult.analysis.architecture_symbols?.classes || []),
      functions: JSON.stringify(analysisResult.analysis.architecture_symbols?.functions || []),
      vulnerabilities: analysisResult.analysis.security_vulnerabilities,
      apiEndpoints: analysisResult.analysis.api_endpoints,
      databaseModels: analysisResult.analysis.database_tables.map((t) => ({
        ormType: t.database_type,
        tableName: t.table_name,
      })),
      repoTree: JSON.stringify(analysisResult.analysis.repo_tree || null),
      branches: JSON.stringify(analysisResult.analysis.branches || null),
      commits: JSON.stringify(analysisResult.analysis.commits || null),
      pullRequests: JSON.stringify(analysisResult.analysis.pull_requests || null),
      repoMetadata: JSON.stringify(analysisResult.analysis.repo_metadata || null),
    });

    const payload = toAnalyzePayload(scan);
    cacheScan(scan.id, payload);

    res.status(200).json(payload);
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.error("❌ GitHub API Error: 401 Unauthorized.");
      return res.status(401).json({ error: "Authentication failed. Check GitHub Token." });
    }
    if (error.response && error.response.status === 404) {
      return res.status(404).json({ error: "Repository not found." });
    }
    console.error("❌ Error processing repository:", error.message);
    res.status(500).json({ error: "Failed to process repository." });
  } finally {
    if (tempFolder && fs.existsSync(tempFolder)) {
      console.log(`5. Cleaning up temporary files...`);
      fs.rmSync(tempFolder, { recursive: true, force: true });
    }
  }
});

// --- ROUTE: THE PROFILE BATCH SCANNER -----------------------------------
app.get("/api/profile", async (req, res) => {
  const username = req.query.user;

  if (!username || !isSafeGithubUsername(username)) {
    return res.status(400).json({ error: "Please provide a valid GitHub username or organization." });
  }

  try {
    console.log(`\n🔍 Fetching entire repository list for user: ${username}...`);
    const githubApiUrl = `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`;

    const response = await axios.get(githubApiUrl, {
      headers: { ...readGithubToken(), "User-Agent": "CodeAtlas-Batch-Scanner" },
    });

    const allRepos = response.data.map((repo) => ({
      name: repo.name,
      full_url: repo.html_url,
      description: repo.description || "No description provided.",
      primary_language: repo.language || "Mixed/Unknown",
      stars: repo.stargazers_count,
      size_kb: repo.size,
      last_updated: repo.updated_at,
    }));

    console.log(`✅ Successfully found ${allRepos.length} repositories for ${username}.`);

    res.status(200).json({
      owner: username,
      total_repositories: allRepos.length,
      repositories: allRepos,
    });
  } catch (error) {
    console.error("❌ Profile Fetch Error:", error.message);
    if (error.response && error.response.status === 404) {
      return res.status(404).json({ error: "GitHub user or organization not found." });
    }
    res.status(500).json({ error: "Failed to fetch profile repositories." });
  }
});

// --- ROUTE: THE CHATBOT --------------------------------------------------
// Previously this endpoint ignored the scanned repository entirely and
// just forwarded the raw message to Ollama - the model had no idea what
// repo you were even asking about. It's now tied to a specific scanId,
// loads that scan's real context (from cache or the database), and
// saves both sides of the conversation.
app.post("/api/chat", optionalAuth, async (req, res) => {
  const { message, scanId } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Message is required." });
  }
  if (!scanId) {
    return res.status(400).json({ error: "scanId is required - run a scan first." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  try {
    let context = recentScanCache.get(scanId);
    if (!context) {
      const scan = db.findScanById(scanId);
      if (!scan) {
        send({ error: "Unknown scanId - run a new scan first." });
        return res.end();
      }
      context = toAnalyzePayload(scan);
      cacheScan(scanId, context);
    }

    db.createChatMessage({
      scanId,
      userId: req.user ? req.user.id : null,
      role: "user",
      content: message,
    });

    const fullReply = await askRepoChatbot(message, context, (token) => {
      send({ token });
    });

    db.createChatMessage({
      scanId,
      userId: req.user ? req.user.id : null,
      role: "assistant",
      content: fullReply,
    });

    send({ done: true });
    res.end();
  } catch (error) {
    console.error("❌ Chat error:", error.message);
    send({ error: "Failed to reach the AI assistant." });
    res.end();
  }
});

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`\n📡 CodeAtlas API is running on http://localhost:${PORT}`));
