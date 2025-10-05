# Query Handling - JavaScript Version

This document explains how to use the converted JavaScript version of the Python RAG query handling system for Cloudflare Workers.

## Overview

The `queryHandling.js` file provides a complete RAG (Retrieval-Augmented Generation) system that:
- Searches your document database using vector similarity
- Integrates with Google Gemini for LLM responses
- Supports both "db-only" and "hybrid" modes
- Includes Google Search integration for hybrid mode

## Environment Variables Required

Make sure these environment variables are set in your Cloudflare Workers environment:

```bash
# Required for Gemini API
GEMINI_API_KEY=your_gemini_api_key_here

# Required for Google Search (hybrid mode only)
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_CSE_ID=your_custom_search_engine_id_here

# Cloudflare Vectorize index name
CF_INDEX_NAME=your_vectorize_index_name_here
```

## API Endpoints

### Main Query Endpoint

**GET** `/query`

This is the primary endpoint for querying your RAG system using the new query handling system.

Parameters:
- `text` (required): The question to ask
- `mode` (optional): "db-only" or "hybrid" (default: "db-only")
- `topK` (optional): Number of documents to retrieve (default: 8)
- `scoreThreshold` (optional): Minimum similarity score (default: 0.72)

Examples:

```bash
# Database-only mode
curl "https://your-worker.your-subdomain.workers.dev/query?text=What%20is%20machine%20learning?&mode=db-only"

# Hybrid mode (includes web search)
curl "https://your-worker.your-subdomain.workers.dev/query?text=What%20is%20machine%20learning?&mode=hybrid"

# Custom parameters
curl "https://your-worker.your-subdomain.workers.dev/query?text=What%20is%20AI?&mode=hybrid&topK=5&scoreThreshold=0.8"
```

## Response Format

```json
{
  "query": "What is machine learning?",
  "answer": "Machine learning is a subset of artificial intelligence...",
  "sources": [
    {
      "id": "123",
      "score": 0.85,
      "source": "ml-textbook.pdf"
    }
  ],
  "sourceDetails": [
    {
      "docId": "123",
      "source": "ml-textbook.pdf",
      "score": 0.85,
      "relevance": "High"
    }
  ],
  "mode": "hybrid",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Modes

### Database-Only Mode (`mode=db-only`)
- Only searches your document database
- Returns "NOT_IN_DB" if no relevant documents found
- Strict threshold checking
- Best for: Internal knowledge base queries

### Hybrid Mode (`mode=hybrid`)
- Searches your document database first
- Falls back to Google Search if database results are insufficient
- Combines both sources for comprehensive answers
- Best for: General knowledge questions with document context

## Key Features

1. **Vector Search**: Uses Google Gemini embeddings for semantic search
2. **Context Building**: Intelligently combines multiple document chunks
3. **Score Thresholding**: Filters out low-relevance results
4. **Provenance Tracking**: Shows which documents were used
5. **Error Handling**: Graceful fallbacks and error reporting

## Configuration

Edit the `CONFIG` object in `queryHandling.js` to customize:

```javascript
const CONFIG = {
  CF_INDEX_NAME: "my-index", // Your Vectorize index name
  EMBEDDING_MODEL: "text-embedding-004", // Gemini embedding model
  GEMINI_MODEL: "gemini-2.0-flash-exp", // Gemini LLM model
  DEFAULT_TOP_K: 8, // Default number of documents to retrieve
  DEFAULT_SCORE_THRESHOLD: 0.72, // Default similarity threshold
  MAX_CONTEXT_CHARS: 3000 // Max characters per document in context
};
```

## Migration from Python

The JavaScript version maintains the same API and functionality as the Python version:

- ✅ Vector similarity search
- ✅ Gemini API integration
- ✅ Google Search integration
- ✅ Agent-based tool orchestration
- ✅ Context building and provenance tracking
- ✅ Both db-only and hybrid modes

## Troubleshooting

1. **"NOT_IN_DB" responses**: Lower the `scoreThreshold` or check if your documents are properly indexed
2. **API errors**: Verify your API keys are correctly set in environment variables
3. **No results**: Ensure your Vectorize index contains data and the index name is correct

## Migration

The `/query` endpoint is now the primary and only query endpoint. It provides enhanced functionality with proper source attribution, doc IDs, and relevance scoring.
