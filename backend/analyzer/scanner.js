// const fs = require("fs");
// const path = require("path");
// const extractSymbols = require("./extractor");
// const extractDatabaseSchemas = require("./schemaExtractor");
// const sniffSecrets = require("./securitySniffer");

// const IGNORE_DIRS = new Set([
//   ".git",
//   "node_modules",
//   "venv",
//   "__pycache__",
//   "dist",
//   "build",
//   ".next",
// ]);

// let techMap;
// try {
//   const mapPath = path.join(__dirname, "technologyMap.json");
//   techMap = JSON.parse(fs.readFileSync(mapPath, "utf-8"));
// } catch (error) {
//   console.error("❌ CRITICAL ERROR: Failed to load technologyMap.json");
//   process.exit(1);
// }

// function analyzeFile(filePath) {
//   try {
//     const ext = path.extname(filePath);
//     const langKey = Object.keys(techMap.languages).find((lang) =>
//       techMap.languages[lang].extensions.includes(ext),
//     );

//     if (!langKey) return null;

//     const langRules = techMap.languages[langKey];
//     const regex = new RegExp(langRules.importPattern, "gm");
//     const content = fs.readFileSync(filePath, "utf-8");

//     const detectedImports = [];
//     let match;

//     while ((match = regex.exec(content)) !== null) {
//       const importName = match[1] || match[2];
//       if (importName) {
//         detectedImports.push(importName.trim());
//       }
//     }

//     return {
//       language: langKey,
//       imports: detectedImports,
//     };
//   } catch (error) {
//     return null;
//   }
// }

// function scanRepository(dirPath) {
//   const results = {
//     totalFiles: 0,
//     filePaths: [],
//     technologies: new Set(),
//     languages: new Set(),
//     classes: new Set(),
//     functions: new Set(),
//     databaseSchemas: [], // <-- 2. Array to track our database tables
//   };

//   function walkDir(currentPath) {
//     try {
//       const files = fs.readdirSync(currentPath);

//       for (const file of files) {
//         if (IGNORE_DIRS.has(file)) {
//           continue;
//         }

//         const fullPath = path.join(currentPath, file);
//         const stat = fs.statSync(fullPath);

//         if (stat.isDirectory()) {
//           walkDir(fullPath);
//         } else {
//           results.totalFiles++;
//           results.filePaths.push(fullPath);

//           const fileAnalysis = analyzeFile(fullPath);
//           if (fileAnalysis) {
//             results.languages.add(fileAnalysis.language);
//             fileAnalysis.imports.forEach((importName) => {
//               const foundTech = techMap.technologies.find((t) =>
//                 t.signatures.includes(importName),
//               );
//               if (foundTech) {
//                 results.technologies.add(foundTech.name);
//               }
//             });
//           }

//           const symbols = extractSymbols(fullPath);
//           symbols.classes.forEach((c) => results.classes.add(c));
//           symbols.functions.forEach((f) => results.functions.add(f));

//           // <-- 3. Extract any database tables found in this file
//           const tables = extractDatabaseSchemas(fullPath);
//           if (tables.length > 0) {
//             results.databaseSchemas.push(...tables);
//           }
//         }
//       }
//     } catch (error) {
//       console.warn(`⚠️ Warning: Could not read directory ${currentPath}`);
//     }
//   }

//   walkDir(dirPath);

//   return {
//     scannedPath: dirPath,
//     totalFiles: results.totalFiles,
//     filePaths: results.filePaths,
//     languages: Array.from(results.languages),
//     technologies: Array.from(results.technologies),
//     classes: Array.from(results.classes),
//     functions: Array.from(results.functions),
//     database_models: results.databaseSchemas, // <-- 4. Export it
//   };
// }

// module.exports = { analyzeFile, scanRepository };

const fs = require("fs");
const path = require("path");
const extractSymbols = require("./extractor");
const extractDatabaseSchemas = require("./schemaExtractor");
const sniffSecrets = require("./securitySniffer");
const extractApiRoutes = require("./apiExtractor");

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "venv",
  "__pycache__",
  "dist",
  "build",
  ".next",
]);

let techMap;
try {
  const mapPath = path.join(__dirname, "technologyMap.json");
  techMap = JSON.parse(fs.readFileSync(mapPath, "utf-8"));
} catch (error) {
  console.error("❌ CRITICAL ERROR: Failed to load technologyMap.json");
  process.exit(1);
}

/**
 * Asynchronously analyzes a file's imports and languages
 */
async function analyzeFile(filePath) {
  try {
    const ext = path.extname(filePath);
    const langKey = Object.keys(techMap.languages).find((lang) =>
      techMap.languages[lang].extensions.includes(ext),
    );

    if (!langKey) return null;

    const langRules = techMap.languages[langKey];
    const regex = new RegExp(langRules.importPattern, "gm");

    // Optimized to use async non-blocking file reads
    const content = await fs.promises.readFile(filePath, "utf-8");

    const detectedImports = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const importName = match[1] || match[2];
      if (importName) {
        detectedImports.push(importName.trim());
      }
    }

    return {
      language: langKey,
      imports: detectedImports,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Helper function to recursively gather all valid file paths asynchronously
 */
async function gatherFilePaths(currentPath, fileList = []) {
  try {
    const files = await fs.promises.readdir(currentPath);

    for (const file of files) {
      if (IGNORE_DIRS.has(file)) continue;

      const fullPath = path.join(currentPath, file);
      const stat = await fs.promises.stat(fullPath);

      if (stat.isDirectory()) {
        await gatherFilePaths(fullPath, fileList);
      } else {
        fileList.push(fullPath);
      }
    }
  } catch (error) {
    console.warn(`⚠️ Warning: Could not read directory ${currentPath}`);
  }
  return fileList;
}

/**
 * Scans a repository completely in parallel using async Promise pools
 */
async function scanRepository(dirPath) {
  // 1. Instantly gather all files in the repository
  const filePaths = await gatherFilePaths(dirPath);

  const results = {
    totalFiles: filePaths.length,
    filePaths: filePaths,
    technologies: new Set(),
    languages: new Set(),
    classes: [],
    functions: [],
    databaseSchemas: [],
    security_vulnerabilities: [],
    api_routes: [],
  };
  // Dedupe on name+file (not just name) so the same class/function name in
  // two different files still shows up once per file, and we don't need a
  // Set-of-strings that would otherwise throw away which file it came from.
  const seenClassKeys = new Set();
  const seenFunctionKeys = new Set();

  // 2. Process all gathered files concurrently using Promise.all
  await Promise.all(
    filePaths.map(async (fullPath) => {
      try {
        // Run API Route extraction
        const routes = extractApiRoutes(fullPath);
        if (routes && routes.length > 0) {
          results.api_routes.push(...routes);
        }

        // Run Language & Framework identification
        const fileAnalysis = await analyzeFile(fullPath);
        if (fileAnalysis) {
          results.languages.add(fileAnalysis.language);
          fileAnalysis.imports.forEach((importName) => {
            const foundTech = techMap.technologies.find((t) =>
              t.signatures.includes(importName),
            );
            if (foundTech) results.technologies.add(foundTech.name);
          });
        }

        // Run Class & Function parser
        const symbols = extractSymbols(fullPath);
        if (symbols) {
          const relPath = path.relative(dirPath, fullPath).split(path.sep).join("/");
          if (symbols.classes) {
            symbols.classes.forEach((c) => {
              const key = `${c}|${relPath}`;
              if (!seenClassKeys.has(key)) {
                seenClassKeys.add(key);
                results.classes.push({ name: c, file: relPath });
              }
            });
          }
          if (symbols.functions) {
            symbols.functions.forEach((f) => {
              const key = `${f}|${relPath}`;
              if (!seenFunctionKeys.has(key)) {
                seenFunctionKeys.add(key);
                results.functions.push({ name: f, file: relPath });
              }
            });
          }
        }

        // Run Schema parser
        const tables = extractDatabaseSchemas(fullPath);
        if (tables && tables.length > 0) {
          results.databaseSchemas.push(...tables);
        }

        // Run Security Sniffer
        const leaks = sniffSecrets(fullPath);
        if (leaks && leaks.length > 0) {
          results.security_vulnerabilities.push(...leaks);
        }
      } catch (fileError) {
        // Fail-safe to let remaining files finish processing if a single file trips up
        console.warn(
          `⚠️ Error processing file ${fullPath}:`,
          fileError.message,
        );
      }
    }),
  );

  return {
    scannedPath: dirPath,
    totalFiles: results.totalFiles,
    filePaths: results.filePaths,
    scannedFiles: results.filePaths.map((fp) =>
      path.relative(dirPath, fp).split(path.sep).join("/"),
    ),
    languages: Array.from(results.languages),
    technologies: Array.from(results.technologies),
    classes: results.classes,
    functions: results.functions,
    database_models: results.databaseSchemas,
    api_endpoints: results.api_routes,
    security_leaks: results.security_vulnerabilities,
  };
}

module.exports = { analyzeFile, scanRepository };
