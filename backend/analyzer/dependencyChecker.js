const fs = require("fs");
const path = require("path");

// Our DevSecOps Dictionary of notoriously vulnerable package versions
const VULNERABILITY_DB = {
  lodash: {
    vulnerable_below: "4.17.21",
    severity: "HIGH",
    threat: "Prototype Pollution",
  },
  axios: {
    vulnerable_below: "0.21.1",
    severity: "HIGH",
    threat: "Server-Side Request Forgery (SSRF)",
  },
  express: {
    vulnerable_below: "4.16.0",
    severity: "MEDIUM",
    threat: "Denial of Service (DoS)",
  },
  django: {
    vulnerable_below: "3.2.0",
    severity: "CRITICAL",
    threat: "SQL Injection vulnerability",
  },
  requests: {
    vulnerable_below: "2.31.0",
    severity: "MEDIUM",
    threat: "Data Leakage",
  },
  jsonwebtoken: {
    vulnerable_below: "9.0.0",
    severity: "CRITICAL",
    threat: "Remote Code Execution (RCE)",
  },
};

/**
 * Strips characters like ^ or ~ from version strings and converts to a comparable number.
 */
function parseVersion(versionString) {
  const clean = versionString.replace(/[\^~=<>]/g, "").trim();
  const parts = clean.split(".");
  // Pad parts to ensure 4.2.0 is seen as smaller than 4.17.0
  return parseFloat(parts.map((p) => p.padStart(3, "0")).join("."));
}

/**
 * Scans repository root for manifest files and checks for vulnerable dependencies.
 */
function auditDependencies(repoPath) {
  const alerts = [];

  // 1. Check Node.js (package.json)
  const pkgPath = path.join(repoPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      for (const [pkgName, version] of Object.entries(allDeps)) {
        if (VULNERABILITY_DB[pkgName]) {
          const currentV = parseVersion(version);
          const safeV = parseVersion(
            VULNERABILITY_DB[pkgName].vulnerable_below,
          );

          if (currentV < safeV) {
            alerts.push({
              type: "Vulnerable Dependency",
              file: "package.json",
              line: "N/A",
              severity: VULNERABILITY_DB[pkgName].severity,
              snippet: `Found ${pkgName}@${version}. Upgrade to v${VULNERABILITY_DB[pkgName].vulnerable_below} to patch ${VULNERABILITY_DB[pkgName].threat}.`,
            });
          }
        }
      }
    } catch (e) {
      console.error("Failed to parse package.json for dependencies.");
    }
  }

  // 2. Check Python (requirements.txt)
  const reqPath = path.join(repoPath, "requirements.txt");
  if (fs.existsSync(reqPath)) {
    try {
      const content = fs.readFileSync(reqPath, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line) => {
        if (line.includes("==") || line.includes(">=")) {
          const [pkgName, version] = line.split(/[=<>]+/);
          const cleanName = pkgName.trim().toLowerCase();

          if (VULNERABILITY_DB[cleanName]) {
            const currentV = parseVersion(version);
            const safeV = parseVersion(
              VULNERABILITY_DB[cleanName].vulnerable_below,
            );

            if (currentV < safeV) {
              alerts.push({
                type: "Vulnerable Dependency",
                file: "requirements.txt",
                line: "N/A",
                severity: VULNERABILITY_DB[cleanName].severity,
                snippet: `Found ${cleanName}@${version.trim()}. Upgrade to v${VULNERABILITY_DB[cleanName].vulnerable_below} to patch ${VULNERABILITY_DB[cleanName].threat}.`,
              });
            }
          }
        }
      });
    } catch (e) {
      console.error("Failed to parse requirements.txt.");
    }
  }

  return alerts;
}

module.exports = auditDependencies;
