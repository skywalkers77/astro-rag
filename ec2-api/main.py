"""
EC2 Python API for RAG Processing
Handles PDF processing, semantic search, and summarization using Gemini 1.5 Flash
"""

import os
import asyncio
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
import uuid

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

from services.pdf_processor import PDFProcessor
from services.gemini_service import GeminiService
from services.embedding_service import EmbeddingService
# from services.cache_service import CacheService  # Removed caching
from models.schemas import (
    ProcessPDFRequest, ProcessPDFResponse, 
    SemanticSearchRequest, SemanticSearchResponse,
    HealthResponse, ErrorResponse
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RAG Processing API",
    description="API for PDF processing, semantic search, and summarization",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
pdf_processor = PDFProcessor()
gemini_service = GeminiService()
embedding_service = EmbeddingService()
# cache_service = CacheService()  # Removed caching

@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    try:
        # Test Gemini connection
        gemini_status = await gemini_service.test_connection()
        
        return HealthResponse(
            status="healthy",
            gemini_status=gemini_status,
            uptime=0,  # Implement uptime tracking
            version="1.0.0"
        )
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=503, detail="Service unhealthy")

@app.post("/api/process-pdf", response_model=ProcessPDFResponse)
async def process_pdf(request: ProcessPDFRequest):
    """Process PDF document and extract text, images, tables"""
    start_time = datetime.now()
    
    try:
        # Process PDF directly (no caching)
        logger.info(f"Processing PDF: {request.pdf_url}")
        
        # Extract text, images, and tables
        extracted_content = await pdf_processor.process_pdf(
            pdf_url=request.pdf_url,
            extract_images=request.options.extract_images,
            extract_tables=request.options.extract_tables,
            chunk_size=request.options.chunk_size,
            chunk_overlap=request.options.chunk_overlap
        )
        
        # Generate embeddings for each chunk
        embeddings = []
        for chunk in extracted_content.chunks:
            embedding = await embedding_service.generate_embedding(chunk.text)
            embeddings.append(embedding)
        
        # Generate summary using Gemini
        summary = await gemini_service.generate_summary(
            chunks=extracted_content.chunks,
            paper_title=request.paper_title
        )
        
        # Create response
        document_id = str(uuid.uuid4())
        response = ProcessPDFResponse(
            success=True,
            document_id=document_id,
            chunks=extracted_content.chunks,
            embeddings=embeddings,
            summary=summary,
            processing_time=(datetime.now() - start_time).total_seconds()
        )
        
        logger.info(f"Successfully processed PDF in {response.processing_time:.2f}s")
        return response
        
    except Exception as e:
        logger.error(f"PDF processing failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"PDF processing failed: {str(e)}"
        )

@app.post("/api/semantic-search", response_model=SemanticSearchResponse)
async def semantic_search(request: SemanticSearchRequest):
    """Perform semantic search across documents"""
    start_time = datetime.now()
    
    try:
        # Generate query embedding
        query_embedding = await embedding_service.generate_embedding(request.query)
        
        # Perform semantic search (this would integrate with your vector database)
        # For now, returning mock results
        results = await perform_semantic_search(
            query_embedding=query_embedding,
            document_ids=request.document_ids,
            top_k=request.top_k,
            similarity_threshold=request.similarity_threshold
        )
        
        response = SemanticSearchResponse(
            success=True,
            results=results,
            query_embedding=query_embedding,
            search_time=(datetime.now() - start_time).total_seconds()
        )
        
        logger.info(f"Semantic search completed in {response.search_time:.2f}s")
        return response
        
    except Exception as e:
        logger.error(f"Semantic search failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Semantic search failed: {str(e)}"
        )

async def perform_semantic_search(
    query_embedding: List[float],
    document_ids: Optional[List[str]] = None,
    top_k: int = 5,
    similarity_threshold: float = 0.7
) -> List[Dict[str, Any]]:
    """Perform semantic search - integrate with your vector database"""
    # This is where you'd integrate with ChromaDB, FAISS, or your vector database
    # For now, returning mock results
    return [
        {
            "chunk_id": "chunk_1",
            "document_id": "doc_123",
            "text": "Relevant text content based on semantic similarity...",
            "similarity_score": 0.89,
            "type": "text",
            "metadata": {
                "page_number": 1,
                "section": "results"
            }
        }
    ]

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
