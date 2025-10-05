# EC2 Python API Specification

## Overview
The EC2 Python API will handle semantic search, image/table extraction, and summarization using Gemini 1.5 Flash, while Workers handle embeddings and storage.

## API Endpoints

### 1. Process PDF Document
**POST** `/api/process-pdf`

**Request Body:**
```json
{
  "pdf_url": "https://example.com/paper.pdf",
  "paper_title": "Research Paper Title",
  "options": {
    "extract_images": true,
    "extract_tables": true,
    "chunk_size": 1000,
    "chunk_overlap": 200
  }
}
```

**Response:**
```json
{
  "success": true,
  "document_id": "doc_123",
  "chunks": [
    {
      "id": "chunk_1",
      "text": "Extracted text content...",
      "type": "text",
      "page_number": 1,
      "metadata": {
        "section": "abstract",
        "confidence": 0.95
      }
    },
    {
      "id": "chunk_2", 
      "text": "Table summary: This table shows...",
      "type": "table",
      "page_number": 3,
      "metadata": {
        "table_caption": "Table 1: Results",
        "confidence": 0.88
      }
    },
    {
      "id": "chunk_3",
      "text": "Image description: This figure shows...",
      "type": "image", 
      "page_number": 5,
      "metadata": {
        "image_caption": "Figure 1: Architecture",
        "confidence": 0.92
      }
    }
  ],
  "embeddings": [
    [0.1, 0.2, 0.3, ...], // 768-dimensional vector for chunk_1
    [0.4, 0.5, 0.6, ...], // 768-dimensional vector for chunk_2
    [0.7, 0.8, 0.9, ...]  // 768-dimensional vector for chunk_3
  ],
  "summary": {
    "abstract": "Paper abstract summary...",
    "key_findings": ["Finding 1", "Finding 2", "Finding 3"],
    "methodology": "Brief methodology description...",
    "conclusions": "Main conclusions..."
  },
  "processing_time": 15.2
}
```

### 2. Semantic Search
**POST** `/api/semantic-search`

**Request Body:**
```json
{
  "query": "What are the main findings about machine learning?",
  "document_ids": ["doc_123", "doc_456"], // Optional: search specific docs
  "top_k": 5,
  "similarity_threshold": 0.7
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "chunk_id": "chunk_1",
      "document_id": "doc_123",
      "text": "Relevant text content...",
      "similarity_score": 0.89,
      "type": "text",
      "metadata": {
        "page_number": 1,
        "section": "results"
      }
    }
  ],
  "query_embedding": [0.1, 0.2, 0.3, ...],
  "search_time": 0.5
}
```

### 3. Health Check
**GET** `/api/health`

**Response:**
```json
{
  "status": "healthy",
  "gemini_status": "connected",
  "uptime": 3600,
  "version": "1.0.0"
}
```

## Technology Stack

### Core Libraries
- **FastAPI**: Web framework
- **Google Generative AI**: Gemini 1.5 Flash integration
- **PyPDF2/pdfplumber**: PDF text extraction
- **PIL/OpenCV**: Image processing
- **pandas**: Table extraction
- **sentence-transformers**: Embeddings (backup to Gemini)
- **chromadb/faiss**: Vector search (optional local storage)

### Infrastructure
- **Docker**: Containerization
- **nginx**: Reverse proxy
- **Redis**: Caching (optional)
- **AWS S3**: File storage (optional)

## Environment Variables
```bash
GOOGLE_API_KEY=your_gemini_api_key
MODEL_NAME=gemini-1.5-flash
MAX_FILE_SIZE=50MB
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
CACHE_TTL=3600
```

## Error Handling
```json
{
  "success": false,
  "error": {
    "code": "PDF_PROCESSING_ERROR",
    "message": "Failed to extract text from PDF",
    "details": "PDF appears to be corrupted or password-protected"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Rate Limiting
- 10 requests per minute per IP
- 100MB total file size per hour
- 5 concurrent processing jobs
