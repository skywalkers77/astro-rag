/**
 * RAG Query Handling for Cloudflare Workers
 * Converted from Python to JavaScript for Cloudflare Workers compatibility
 */

// -------------------------
// Configuration
// -------------------------
const CONFIG = {
    CF_INDEX_NAME: "my-index", // Replace with your actual index name
    EMBEDDING_MODEL: "text-embedding-004",
    GEMINI_MODEL: "gemini-2.0-flash-exp",
    DEFAULT_TOP_K: 8,
    DEFAULT_SCORE_THRESHOLD: 0.72,
    MAX_CONTEXT_CHARS: 1500
};

// -------------------------
// System Prompts
// -------------------------
const SYSTEM_PROMPT_DB_ONLY = `
You are an assistant that MUST ONLY use the provided documents below to answer the user's question.
Do NOT use any external knowledge beyond these documents. If the documents do NOT contain enough
information to answer the question, reply exactly: "NOT_IN_DB". Provide a short justification
(one sentence) referencing which documents you used, and include the doc ids used.
`;

const SYSTEM_PROMPT_HYBRID = `
You are an assistant that SHOULD PRIORITIZE the provided vector_db tool when answering.
You MAY use external knowledge and the google_search to help if the vector_db doesn't fully answer the question,
- Rephrase the user's query if needed before calling google_search, but give priority to the vector_db results. 
- When using vector_db content, you MUST cite the doc id(s).
- If the vector_db is sufficient, do not add external facts unless they are directly relevant.
`;

// -------------------------
// Vector Search Functions
// -------------------------

/**
 * Generate embeddings using Google Gemini API
 */
async function generateEmbeddings(text, env) {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.EMBEDDING_MODEL}:embedContent?key=${env.GOOGLE_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: {
                    parts: [{ text: text }]
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.embedding.values;
    } catch (error) {
        console.error('Error generating embeddings:', error);
        throw error;
    }
}

/**
 * Search for similar documents in Cloudflare Vectorize
 */
async function retrieveDocs(query, topK = CONFIG.DEFAULT_TOP_K, env) {
    try {
        // Generate embeddings for the query
        const queryEmbeddings = await generateEmbeddings(query, env);

        // Search in Vectorize
        const vectorQuery = await env.VECTORIZE.query(queryEmbeddings, { topK });

        if (!vectorQuery.matches || vectorQuery.matches.length === 0) {
            return [];
        }

        // Get document details from database
        const chunkIds = vectorQuery.matches.map(match => match.id);
        const placeholders = chunkIds.map(() => '?').join(',');
        const query_sql = `SELECT * FROM pdfs WHERE id IN (${placeholders}) ORDER BY chunk_index ASC`;
        const { results } = await env.database.prepare(query_sql).bind(...chunkIds).run();

        if (!results) {
            return [];
        }

        // Combine vector scores with document data
        const matches = [];
        for (const match of vectorQuery.matches) {
            const doc = results.find(r => r.id.toString() === match.id);
            if (doc) {
                matches.push({
                    document: {
                        page_content: doc.text,
                        metadata: {
                            id: doc.id,
                            source: doc.filename,
                            chunk_index: doc.chunk_index,
                            total_chunks: doc.total_chunks
                        }
                    },
                    score: match.score
                });
            }
        }

        return matches;
    } catch (error) {
        console.error('Error retrieving documents:', error);
        throw error;
    }
}

// -------------------------
// Context Building
// -------------------------

/**
 * Build context snippet from matches
 */
function buildContextSnippet(matches, includeLimitChars = CONFIG.MAX_CONTEXT_CHARS) {
    const parts = [];
    const provenance = [];

    for (let i = 0; i < matches.length; i++) {
        const { document: doc, score } = matches[i];
        let text = doc.page_content.trim();

        // Truncate to avoid huge prompts
        if (text.length > includeLimitChars) {
            text = text.substring(0, includeLimitChars) + " …";
        }

        parts.push(`--- DOC ${i + 1} (id=${doc.metadata.id || 'unknown'}, score=${score.toFixed(4)}) ---\n${text}\n`);
        provenance.push({
            id: doc.metadata.id,
            score: score,
            source: doc.metadata.source
        });
    }

    const contextText = parts.join("\n\n");
    return { contextText, provenance };
}

// -------------------------
// Gemini API Integration
// -------------------------

/**
 * Call Gemini API with context
 */
async function callGeminiWithContext(systemPrompt, userQuery, context, env, temperature = 0.0, maxOutputTokens = 512) {
    try {
        const prompt = `${systemPrompt}\n\nCONTEXT:\n${context}\n\nUSER QUERY:\n${userQuery}\n\nAnswer:`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: temperature,
                    maxOutputTokens: maxOutputTokens
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;
        return { text, raw: data };
    } catch (error) {
        console.error('Error calling Gemini:', error);
        throw error;
    }
}

// -------------------------
// Tool Functions
// -------------------------

/**
 * Database query tool for vector search
 */
async function dbQueryTool(query, topK = 5, env) {
    try {
        const results = await retrieveDocs(query, topK, env);
        const formattedResults = results.map(({ document: doc, score }, i) => ({
            doc_id: doc.metadata.id || `unknown_${i}`,
            score: Math.round(score * 1000) / 1000,
            source: doc.metadata.source || "unknown",
            snippet: doc.page_content.substring(0, 300) + "..."
        }));
        return formattedResults;
    } catch (error) {
        console.error('Error in dbQueryTool:', error);
        return [];
    }
}

/**
 * Google Search tool
 */
async function googleSearchTool(query, env) {
    try {
        if (!env.GOOGLE_SEARCH_API_KEY || !env.GOOGLE_CSE_ID) {
            throw new Error('Google API credentials not configured');
        }

        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_SEARCH_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}`;

        const response = await fetch(searchUrl);
        if (!response.ok) {
            throw new Error(`Google Search API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.items ? data.items.map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet
        })) : [];
    } catch (error) {
        console.error('Error in googleSearchTool:', error);
        return [];
    }
}

// -------------------------
// Agent System (Simplified)
// -------------------------

/**
 * Simple agent that decides which tools to use
 */
async function runAgent(query, mode, env) {
    try {
        // First, try database search
        const dbResults = await dbQueryTool(query, 5, env);

        if (mode === "db-only") {
            if (dbResults.length === 0) {
                return "NOT_IN_DB";
            }

            // Check if top result meets threshold
            const topScore = dbResults[0].score;
            if (topScore < CONFIG.DEFAULT_SCORE_THRESHOLD) {
                return "NOT_IN_DB";
            }

            // Use only database results
            const context = dbResults.map(r =>
                `Doc ID: ${r.doc_id}, Source: ${r.source}, Score: ${r.score}\n${r.snippet}`
            ).join('\n\n');

            const { text } = await callGeminiWithContext(SYSTEM_PROMPT_DB_ONLY, query, context, env);
            return text;
        }

        // Hybrid mode: use both database and web search
        let context = "";
        if (dbResults.length > 0) {
            context += "Database Results:\n" + dbResults.map(r =>
                `Doc ID: ${r.doc_id}, Source: ${r.source}, Score: ${r.score}\n${r.snippet}`
            ).join('\n\n') + "\n\n";
        }

        // If database results are insufficient, add web search
        if (dbResults.length === 0 || dbResults[0].score < CONFIG.DEFAULT_SCORE_THRESHOLD) {
            const webResults = await googleSearchTool(query, env);
            if (webResults.length > 0) {
                context += "Web Search Results:\n" + webResults.map(r =>
                    `${r.title}\n${r.snippet}\n${r.link}`
                ).join('\n\n');
            }
        }

        const { text } = await callGeminiWithContext(SYSTEM_PROMPT_HYBRID, query, context, env);
        return text;

    } catch (error) {
        console.error('Error in runAgent:', error);
        throw error;
    }
}

// -------------------------
// Main Query Function
// -------------------------

/**
 * Main function to answer queries using RAG
 */
async function answerQuery(query, mode = "db-only", topK = CONFIG.DEFAULT_TOP_K, scoreThreshold = CONFIG.DEFAULT_SCORE_THRESHOLD, env) {
    try {
        if (mode === "db-only") {
            const matches = await retrieveDocs(query, topK, env);

            if (matches.length === 0) {
                return { answer: "NOT_IN_DB", provenance: [] };
            }

            // Check top score
            const topScore = matches[0].score;
            const { contextText, provenance } = buildContextSnippet(matches);

            // If top result is below threshold, return NOT_IN_DB
            if (topScore < scoreThreshold) {
                return { answer: "NOT_IN_DB", provenance };
            }

            const { text: answer, raw } = await callGeminiWithContext(SYSTEM_PROMPT_DB_ONLY, query, contextText, env);
            return { answer, provenance, raw };

        } else if (mode === "hybrid") {
            const answer = await runAgent(query, mode, env);
            return { answer };

        } else {
            throw new Error("mode must be 'db-only' or 'hybrid'");
        }
    } catch (error) {
        console.error('Error in answerQuery:', error);
        throw error;
    }
}

// -------------------------
// Export functions
// -------------------------
export {
    answerQuery,
    retrieveDocs,
    generateEmbeddings,
    dbQueryTool,
    googleSearchTool,
    buildContextSnippet,
    callGeminiWithContext,
    CONFIG
};
