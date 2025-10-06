# Astro-Rag: NASA Knowledge Base

A comprehensive Retrieval-Augmented Generation (RAG) system built on Cloudflare Workers that processes PDF documents and provides intelligent query responses using AI. This project won first place at the NASA NYC Hackathon, demonstrating advanced AI capabilities for document processing and intelligent querying.

## Overview

This award-winning project demonstrates a complete RAG pipeline that:
- Ingests PDF documents from URLs
- Extracts text, images, and tables using AI
- Converts content into searchable chunks with embeddings
- Provides intelligent query responses using vector similarity search
- Includes voice-to-text functionality for natural interaction

##  Architecture

### Tech Stack
- **Backend**: Cloudflare Workers (Serverless)
- **Frontend**: Cloudflare Pages
- **Database**: Cloudflare D1 (SQLite)
- **Vector Store**: Cloudflare Vectorize
- **AI Models**: 
  - Gemini 2.5 Pro (Query Processing)
  - Gemini 1.5 Flash (Content Processing)
  - Gemini Embeddings 004 (Vector Generation)
- **PDF Processing**: Cloudflare AI toMarkdown

### System Components

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │   API Endpoints  │    │   AI Processing │
│ (Cloudflare     │◄──►│ (Cloudflare      │◄──►│ (Gemini Models) │
│  Pages)         │    │  Workers)        │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │   Data Storage   │
                       │ D1 + Vectorize   │
                       └──────────────────┘
```

## Features

### Document Ingestion
- **PDF Processing**: Extract text from PDFs using Cloudflare AI
- **Image Analysis**: Extract and describe images/graphs using Gemini 1.5
- **Table Extraction**: Convert tables to structured data and markdown
- **Smart Chunking**: Split content into 8K character chunks for optimal context
- **Vector Embeddings**: Generate embeddings using Gemini Embeddings 004

### Query Processing
- **Vector Search**: Semantic similarity search across document chunks
- **Hybrid Mode**: Combine database results with web search when needed
- **Source Attribution**: Track and cite document sources
- **Voice Input**: Convert speech to text for natural querying

### Data Management
- **Chunk Storage**: Store document chunks in Cloudflare D1
- **Vector Storage**: Store embeddings in Cloudflare Vectorize
- **Metadata Tracking**: Track chunk indices, file sources, and processing stats

##  API Endpoints

### Document Ingestion
```http
POST /ingest
Content-Type: application/json

{
  "pdfUrl": "https://example.com/document.pdf",
  "filename": "document.pdf"
}
```

### Query Processing
```http
GET /query?text=your question&mode=hybrid&topK=8&scoreThreshold=0.72
```

### Data Retrieval
```http
GET /chunks                    # Get chunk statistics
GET /chunks/:filename         # Get chunks for specific document
GET /tables?filename=doc.pdf  # Get extracted tables
GET /images?filename=doc.pdf  # Get image descriptions
```

## Deployment

### Prerequisites
- Cloudflare account
- Google AI API key
- Google Search API key (for hybrid mode)

### Environment Setup
1. **Cloudflare D1 Database**:
   ```sql
   CREATE TABLE pdfs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     text TEXT,
     filename TEXT,
     pdf_url TEXT,
     chunk_index INTEGER,
     total_chunks INTEGER,
     chunk_size INTEGER,
     original_text_length INTEGER
   );
   ```

2. **Cloudflare Vectorize Index**:
   - Create index with 768 dimensions (Gemini Embeddings 004)
   - Configure for similarity search

3. **Environment Variables**:
   ```bash
   GOOGLE_API_KEY=your_gemini_api_key
   GEMINI_API_KEY=your_gemini_api_key
   GOOGLE_CSE_ID=your_custom_search_engine_id
   GOOGLE_SEARCH_API_KEY=your_search_api_key
   ```

### Deployment Commands
```bash
# Install dependencies
pnpm install

# Deploy to Cloudflare Workers
pnpm run deploy

# Development server
pnpm run dev
```

## Workflow Process

### 1. Document Ingestion
1. **PDF Fetch**: Download PDF from provided URL
2. **Text Extraction**: Use Cloudflare AI toMarkdown for text extraction
3. **Content Analysis**: 
   - Extract tables using Gemini 1.5 Flash
   - Analyze images and generate descriptions
   - Convert tables to structured JSON
4. **Chunking**: Split text into 8K character chunks with 500 character overlap
5. **Embedding Generation**: Create vector embeddings using Gemini Embeddings 004
6. **Storage**: Store chunks in D1 and embeddings in Vectorize

### 2. Query Processing
1. **Query Embedding**: Convert user query to vector
2. **Vector Search**: Find similar chunks in Vectorize
3. **Context Building**: Retrieve relevant document chunks
4. **AI Response**: Generate answer using Gemini 2.5 Pro with context
5. **Source Attribution**: Include document sources and confidence scores

## Query Modes

### Database Only (`db-only`)
- Uses only ingested documents
- Returns "NOT_IN_DB" if no relevant content found
- Provides source attribution for all responses

### Hybrid Mode (`hybrid`)
- Combines database results with web search
- Falls back to web search when database results are insufficient
- Provides comprehensive answers with multiple sources

## Performance Features

- **Smart Chunking**: 8K character chunks optimize for LLM context windows
- **Overlap Strategy**: 500 character overlap maintains context continuity
- **Score Thresholding**: Configurable relevance scoring (default: 0.72)
- **Batch Processing**: Efficient embedding generation and storage
- **Error Handling**: Graceful fallbacks for PDF processing failures

## Development

### Project Structure
```
├── src/
│   └── index.js              # Main Worker entry point
├── queryHandling.js          # RAG query processing logic
├── queryHandling.py          # Python reference implementation
├── test/
│   └── index.spec.js         # Test suite
├── wrangler.jsonc           # Cloudflare Workers configuration
└── package.json             # Dependencies and scripts
```

### Testing
```bash
# Run tests
pnpm test

# Development with hot reload
pnpm run dev
```

## Use Cases

- **NASA Research**: Process and query scientific publications and research papers
- **Space Documentation**: Create searchable knowledge bases for space missions
- **Scientific Analysis**: Extract insights from large technical documents
- **Educational Tools**: Build interactive learning systems for space science
- **Enterprise Search**: Enable semantic search across technical documentation
- **Research Collaboration**: Facilitate knowledge sharing in scientific communities

##  Monitoring

The system includes comprehensive logging and monitoring:
- Chunk processing statistics
- Embedding generation metrics
- Query performance tracking
- Error handling and fallback mechanisms

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Achievement

**Winner of the NASA NYC Hackathon** - This project was recognized for its innovative approach to document processing and AI-powered query systems, demonstrating the potential of modern AI technologies in scientific research and knowledge management.

## Acknowledgments

- **NASA** for hosting the NYC Hackathon and inspiring innovation in space technology
- **Cloudflare** for providing the serverless platform and AI capabilities
- **Google** for the powerful Gemini AI models
- **The open-source community** for various libraries and tools that made this project possible

---

**Built with ❤️ using Cloudflare Workers and Google AI | NASA NYC Hackathon Winner 2025**
