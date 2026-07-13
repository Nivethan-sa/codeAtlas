const fs = require("fs");
const path = require("path");

/**
 * Scans a file for API endpoint definitions (Express, Flask, FastAPI, etc.)
 * @param {string} filePath - Absolute path to the file.
 * @returns {Array} - List of found API routes.
 */
function extractApiRoutes(filePath) {
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    return [];
  }

  const routes = [];
  const fileName = path.basename(filePath);

  // JavaScript/TypeScript (Express, Router)
  // Matches: app.get('/users') or router.post('/login')
  const jsRegex =
    /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`](.*?)['"`]/gi;

  // Python (Flask, FastAPI, Django-style decorators)
  // Matches: @app.get('/users') or @router.post('/login')
  const pyRegex =
    /@(?:app|router)\.(get|post|put|delete|patch|route)\s*\(\s*['"`](.*?)['"`]/gi;

  let match;

  // Extract JS Routes
  while ((match = jsRegex.exec(content)) !== null) {
    routes.push({
      method: match[1].toUpperCase(),
      endpoint: match[2],
      file: fileName,
    });
  }

  // Extract Python Routes
  while ((match = pyRegex.exec(content)) !== null) {
    let method = match[1].toUpperCase();
    if (method === "ROUTE") method = "GET/POST"; // Flask default

    routes.push({
      method: method,
      endpoint: match[2],
      file: fileName,
    });
  }

  return routes;
}

module.exports = extractApiRoutes;
