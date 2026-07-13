// /**
//  * Sends a conversational query to the local LLM, armed with the repository context.
//  * @param {string} question - The user's chat message.
//  * @param {Object} context - The massive JSON object we generated during the scan.
//  * @returns {Promise<string>} - The AI's response.
//  */
// async function askRepoChatbot(question, context) {
//   // 1. Build the System Prompt (Giving the AI its memory)
//   let prompt = `You are "Atlas," a senior AI developer assistant. You are answering a question about a repository named '${context.repository}'.\n\n`;
//   prompt += `Here is the architectural data we extracted from this repository:\n`;
//   prompt += `- Frameworks: ${context.analysis.frameworks.join(", ")}\n`;

//   if (context.analysis.security_vulnerabilities) {
//     prompt += `- Security Leaks Found: ${context.analysis.security_vulnerabilities.length}\n`;
//   }

//   prompt += `- AI Architectural Summary: ${context.analysis.basic_summary}\n`;
//   prompt += `- Deep Business Logic: ${context.analysis.business_logic}\n\n`;

//   if (
//     context.analysis.database_tables &&
//     context.analysis.database_tables.length > 0
//   ) {
//     prompt += `- Database Tables: ${context.analysis.database_tables.map((t) => t.table_name).join(", ")}\n\n`;
//   }

//   prompt += `USER QUESTION: "${question}"\n\n`;
//   prompt += `Answer the user's question directly, concisely, and accurately based ONLY on the data provided above. Do not hallucinate code you haven't seen.`;

//   try {
//     // 2. Ping your local Ollama instance (Make sure Ollama is running!)
//     const response = await fetch("http://127.0.0.1:11434/api/generate", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         model: "phi3", // CHANGE THIS if you are using mistral, phi3, etc.
//         prompt: prompt,
//         stream: false,
//       }),
//     });

//     if (!response.ok) throw new Error("Ollama connection failed");

//     const data = await response.json();
//     return data.response.trim();
//   } catch (error) {
//     console.error("❌ Chat Agent Error:", error.message);
//     return "I am currently offline or unable to reach the local LLM. Please make sure Ollama is running.";
//   }
// }

// module.exports = askRepoChatbot;
/**
 * Sends a conversational query to the local LLM, armed with the repository context.
 * Streams tokens back via onToken callback for near-instant perceived response time.
 * @param {string} question - The user's chat message.
 * @param {Object} context - The massive JSON object we generated during the scan.
 * @param {Function} [onToken] - Optional callback invoked with each streamed chunk of text.
 * @returns {Promise<string>} - The AI's full response (also available token-by-token via onToken).
 */

// Cache built system prompts per repo so we don't rebuild the static part every call
const _systemPromptCache = new Map();

function buildSystemPrompt(context) {
  const cacheKey = context.repository;
  if (_systemPromptCache.has(cacheKey)) {
    return _systemPromptCache.get(cacheKey);
  }

  let prompt = `You are "Atlas," a senior AI developer assistant. You are answering a question about a repository named '${context.repository}'.\n\n`;
  prompt += `Here is the architectural data we extracted from this repository:\n`;
  prompt += `- Frameworks: ${context.analysis.frameworks.join(", ")}\n`;

  if (context.analysis.security_vulnerabilities) {
    prompt += `- Security Leaks Found: ${context.analysis.security_vulnerabilities.length}\n`;
  }

  // Truncate long fields so prompt stays small (faster time-to-first-token)
  const summary = (context.analysis.basic_summary || "").slice(0, 500);
  const businessLogic = (context.analysis.business_logic || "").slice(0, 500);

  prompt += `- AI Architectural Summary: ${summary}\n`;
  prompt += `- Deep Business Logic: ${businessLogic}\n\n`;

  if (
    context.analysis.database_tables &&
    context.analysis.database_tables.length > 0
  ) {
    prompt += `- Database Tables: ${context.analysis.database_tables.map((t) => t.table_name).join(", ")}\n\n`;
  }

  _systemPromptCache.set(cacheKey, prompt);
  return prompt;
}

async function askRepoChatbot(question, context, onToken) {
  const systemPrompt = buildSystemPrompt(context);

  const prompt =
    systemPrompt +
    `USER QUESTION: "${question}"\n\n` +
    `Answer the user's question directly, concisely, and accurately based ONLY on the data provided above. Do not hallucinate code you haven't seen.`;

  try {
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral", // CHANGE THIS if you are using mistral, llama3, etc.
        prompt: prompt,
        stream: true, // stream tokens instead of waiting for full response
        keep_alive: "30m", // keep model loaded in memory between calls
        options: {
          num_predict: 200, // cap output length to bound latency
          num_ctx: 2048, // avoid over-allocating context window
        },
      }),
    });

    if (!response.ok || !response.body)
      throw new Error("Ollama connection failed");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Ollama streams newline-delimited JSON objects; split carefully in case
      // a chunk boundary lands mid-line
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep any incomplete trailing line for next loop

      for (const line of lines) {
        if (!line.trim()) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue; // skip malformed partial line
        }
        if (obj.response) {
          full += obj.response;
          if (onToken) onToken(obj.response);
        }
      }
    }

    // Flush any trailing buffered line
    if (buffer.trim()) {
      try {
        const obj = JSON.parse(buffer);
        if (obj.response) {
          full += obj.response;
          if (onToken) onToken(obj.response);
        }
      } catch {
        // ignore trailing partial JSON
      }
    }

    return full.trim();
  } catch (error) {
    console.error("❌ Chat Agent Error:", error.message);
    const fallback =
      "I am currently offline or unable to reach the local LLM. Please make sure Ollama is running.";
    if (onToken) onToken(fallback);
    return fallback;
  }
}

module.exports = askRepoChatbot;
