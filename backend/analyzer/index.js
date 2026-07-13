// const { scanRepository } = require("./scanner");
// const summarizeBusinessLogic = require("./summarizer");
// const generateHealthScore = require("./healthScorer"); // <-- 1. Import the scorer
// const fs = require("fs");
// const path = require("path");

// async function analyzeRepository(repoPath, repoName) {
//   const scanResults = scanRepository(repoPath);
//   const summary = await summarizeBusinessLogic(scanResults.filePaths, repoName);

//   let detectedDescription = "Description not found";
//   const packageJsonPath = path.join(repoPath, "package.json");

//   if (fs.existsSync(packageJsonPath)) {
//     try {
//       const packageData = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
//       if (packageData.description)
//         detectedDescription = packageData.description;
//     } catch (error) {}
//   }

//   // 2. Package all the data we want to score
//   const preScoreData = {
//     totalFiles: scanResults.totalFiles,
//     description: detectedDescription,
//     technologies: scanResults.technologies,
//     classes: scanResults.classes,
//     functions: scanResults.functions,
//     database_models: scanResults.database_models,
//   };

//   // 3. Generate the Report Card
//   const healthReport = generateHealthScore(preScoreData);

//   // 4. Return the Final Object
//   return {
//     repository: repoName,
//     description: detectedDescription,

//     // The shiny new grading section!
//     health_audit: healthReport,

//     analysis: {
//       files: scanResults.totalFiles,
//       languages: scanResults.languages,
//       frameworks: scanResults.technologies,
//       database_tables: scanResults.database_models,

//       architecture_symbols: {
//         total_classes: scanResults.classes.length,
//         total_functions: scanResults.functions.length,
//         classes: scanResults.classes,
//         functions: scanResults.functions,
//       },

//       basic_summary: summary.basic,
//       business_logic: summary.logic,
//     },
//   };
// }

// module.exports = analyzeRepository;

const { scanRepository } = require("./scanner");
const summarizeBusinessLogic = require("./summarizer");
const generateHealthScore = require("./healthScorer");
const auditDependencies = require("./dependencyChecker");
const generateAST = require("./astParser"); // <-- ADD THIS
const buildRepoTree = require("./repoTree");
const fs = require("fs");
const path = require("path");

async function analyzeRepository(repoPath, repoName) {
  // 1. Scan files (with defensive fallback)
  const scanResults = (await scanRepository(repoPath)) || {};

  // 2. AI Summarization (Wrapped in a try/catch so Ollama can't crash the server)
  let summary;
  try {
    summary = await summarizeBusinessLogic(
      scanResults.filePaths || [],
      repoName,
    );
  } catch (error) {
    console.warn("⚠️ AI Summarizer failed to connect. Using fallback text.");
    summary = {
      basic: "AI summary unavailable.",
      logic: "AI logic dive unavailable.",
    };
  }

  // Ensure summary always exists
  summary = summary || {
    basic: "AI summary unavailable.",
    logic: "AI logic dive unavailable.",
  };

  // 3. Dependency Check & Security merging
  let totalSecurityAlerts = scanResults.security_leaks || [];
  try {
    const dependencyAlerts = auditDependencies(repoPath);
    totalSecurityAlerts = [...totalSecurityAlerts, ...dependencyAlerts];
  } catch (error) {
    console.warn("⚠️ Dependency auditor encountered an error.");
  }

  // 4. Description Check
  let detectedDescription = "Description not found";
  const packageJsonPath = path.join(repoPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageData = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (packageData.description)
        detectedDescription = packageData.description;
    } catch (error) {}
  }

  // 5. BULLETPROOF PRE-SCORE DATA
  // Using `|| []` ensures that if a module is outdated or fails, it defaults to an empty array instead of `undefined`, preventing the 'length' crash!
  const preScoreData = {
    totalFiles: scanResults.totalFiles || 0,
    description: detectedDescription,
    technologies: scanResults.technologies || [],
    classes: scanResults.classes || [],
    functions: scanResults.functions || [],
    database_models: scanResults.database_models || [],
    security_leaks: totalSecurityAlerts,
  };

  const healthReport = generateHealthScore(preScoreData);
  const astData = generateAST(scanResults.filePaths || [], repoPath);

  // Cap how many file paths we ship to the frontend's "Files Accessed"
  // panel - the true count (scanResults.totalFiles) is still reported in
  // full, this just bounds the DOM/JSON size for very large repositories.
  const SCANNED_FILES_DISPLAY_CAP = 500;
  const allScannedFiles = scanResults.scannedFiles || [];
  const scannedFilesForDisplay = allScannedFiles.slice(0, SCANNED_FILES_DISPLAY_CAP);

  // 6. Repo tree (parent -> child folder/file structure + counts). Built
  // from the *full* scanned file list (not the display-capped slice
  // above), so counts stay accurate even for huge repos.
  let repoTree;
  try {
    repoTree = buildRepoTree(allScannedFiles);
  } catch (error) {
    console.warn("⚠️ Repo tree builder failed.");
    repoTree = { tree: null, total_files: 0, total_folders: 0, max_depth: 0 };
  }

  return {
    repository: repoName,
    description: detectedDescription,
    health_audit: healthReport,
    analysis: {
      files: scanResults.totalFiles || 0,
      scanned_files: scannedFilesForDisplay,
      scanned_files_truncated: allScannedFiles.length > SCANNED_FILES_DISPLAY_CAP,
      languages: scanResults.languages || [],
      frameworks: scanResults.technologies || [],
      database_tables: scanResults.database_models || [],
      api_endpoints: scanResults.api_endpoints || [],
      security_vulnerabilities: totalSecurityAlerts,
      ast_structure: astData,
      repo_tree: repoTree,
      architecture_symbols: {
        total_classes: (scanResults.classes || []).length,
        total_functions: (scanResults.functions || []).length,
        classes: scanResults.classes || [],
        functions: scanResults.functions || [],
      },
      basic_summary: summary.basic || "N/A",
      business_logic: summary.logic || "N/A",
    },
  };
}

module.exports = analyzeRepository;
