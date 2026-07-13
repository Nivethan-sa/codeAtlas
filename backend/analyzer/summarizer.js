// const axios = require("axios");
// const fs = require("fs");
// const path = require("path");

// async function summarizeBusinessLogic(files, repoName) {
//   // 1. Identify files that likely hold business logic
//   const logicPatterns = [
//     "app.py",
//     "main.py",
//     "routes",
//     "views",
//     "controller",
//     "service",
//   ];

//   const coreFiles = files
//     .filter((filePath) => {
//       const fileName = path.basename(filePath).toLowerCase();
//       return logicPatterns.some((pattern) => fileName.includes(pattern));
//     })
//     .slice(0, 4); // Limit to top 4 files so local processing stays fast

//   if (coreFiles.length === 0) {
//     return "Could not identify core routing or controller files to summarize.";
//   }

//   // 2. Read the code from those files to build the context
//   let codeContext = `Repository: ${repoName}\n\n`;

//   coreFiles.forEach((file) => {
//     try {
//       const content = fs.readFileSync(file, "utf8");
//       // Take the first 3000 chars to avoid overwhelming your local RAM
//       codeContext += `--- File: ${path.basename(file)} ---\n${content.substring(0, 3000)}\n\n`;
//     } catch (error) {
//       console.log(`Could not read ${file} for AI summary`);
//     }
//   });

//   // 3. Prompt your local Ollama instance
//   const promptText = `
//     Act as a Senior Software Architect handing over a project to a new developer.
//     Analyze the following code excerpts and provide a concise, high-level summary of the business logic.
//     Focus on:
//     1. The primary purpose of the application.
//     2. The main workflows or API routes.
//     3. How data is being processed or stored.
//     4. What was the role of users and how they get gains of this idea

//     Keep the response professional, easy to read, and formatted in Markdown. Do not include raw code.

//     Code Context:
//     ${codeContext}
//   `;

//   try {
//     console.log(
//       "Sending code to local Ollama for analysis... (this may take a few seconds)",
//     );

//     const response = await axios.post("http://127.0.0.1:11434/api/generate", {
//       model: "mistral", // Change this if you downloaded a different model (like 'phi3' or 'mistral')
//       prompt: promptText,
//       stream: false, // We wait for the full response instead of streaming chunks
//     });

//     return response.data.response;
//   } catch (error) {
//     console.error("Ollama API Error:", error.message);
//     return "Local AI Summary failed. Please ensure the Ollama app is running in the background.";
//   }
// }

// module.exports = summarizeBusinessLogic;

const fs = require("fs");
const path = require("path");

// 1. Primary Bouncer: Looks for deep backend logic
const HIGH_VALUE_PATTERNS = [
  /routes.*\.js$/,
  /controller.*\.js$/,
  /index\.js$/,
  /app\.js$/,
  /main\.py$/,
  /service.*\.js$/,
  /model.*\.js$/,
];

// 2. Fallback Bouncer: Looks for general context if logic is missing
const FALLBACK_PATTERNS = [
  /README\.md$/i,
  /package\.json$/,
  /index\.html$/,
  /docker-compose\.ya?ml$/,
];

async function summarizeBusinessLogic(filePaths, repoName) {
  let hasCoreLogic = true;

  // Try to find the heavy logic files first
  let filesToAnalyze = filePaths.filter((filePath) =>
    HIGH_VALUE_PATTERNS.some((pattern) => pattern.test(filePath)),
  );

  // If no backend logic is found, trigger the fallback mechanism
  if (filesToAnalyze.length === 0) {
    hasCoreLogic = false;
    filesToAnalyze = filePaths.filter((filePath) =>
      FALLBACK_PATTERNS.some((pattern) => pattern.test(filePath)),
    );

    // If it STILL can't find anything (a very weird repo), just grab the first 3 files
    if (filesToAnalyze.length === 0 && filePaths.length > 0) {
      filesToAnalyze = filePaths.slice(0, 3);
    }
  }

  // If the repository is completely empty
  if (filesToAnalyze.length === 0) {
    return {
      basic: "Empty repository.",
      logic: "No files found to analyze.",
    };
  }

  // 3. Dynamic Prompt Construction
  let prompt = `You are a senior software architect analyzing a repository named '${repoName}'.\n`;
  prompt += `Analyze the following files and output a strict JSON object with EXACTLY two keys:\n`;
  prompt += `- "basic_summary": A 1-2 sentence high-level description of what this project does.\n`;

  // Tell the AI how to handle the logic section based on what files we found
  if (hasCoreLogic) {
    prompt += `- "business_logic": A detailed explanation of the primary workflows, API routes, and data management.\n\n`;
  } else {
    prompt += `- "business_logic": State that deep backend logic files were not found, but describe the overall structure, dependencies, or purpose based on the configuration or README files provided.\n\n`;
  }

  filesToAnalyze.forEach((file) => {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const truncatedContent =
        content.length > 4000
          ? content.slice(0, 4000) + "\n...[TRUNCATED]"
          : content;
      prompt += `--- FILE: ${path.basename(file)} ---\n${truncatedContent}\n\n`;
    } catch (error) {
      console.warn(`⚠️ Warning: Could not read ${file} for summarization.`);
    }
  });

  try {
    console.log(
      `🤖 Sending ${filesToAnalyze.length} files to local LLM for JSON analysis...`,
    );

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral", // Remember to keep this matching your downloaded model (e.g., llama3.1)
        prompt: prompt,
        stream: false,
        format: "json",
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Ollama Error ${response.status}: ${errorData}`);
    }

    const data = await response.json();
    const parsedAIResponse = JSON.parse(data.response.trim());

    return {
      basic: parsedAIResponse.basic_summary || "Basic summary unavailable.",
      logic:
        parsedAIResponse.business_logic ||
        "Business logic summary unavailable.",
    };
  } catch (error) {
    console.error("❌ LLM Connection or Parsing Failed.");
    console.error(error.message);
    return {
      basic: "AI summary unavailable.",
      logic: "LLM offline or response was not valid JSON.",
    };
  }
}

module.exports = summarizeBusinessLogic;
