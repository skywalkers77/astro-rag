"""
Pydantic models for API request/response schemas
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from datetime import datetime

class ProcessingOptions(BaseModel):
    """Options for PDF processing"""
    extract_images: bool = Field(default=True, description="Extract and summarize images")
    extract_tables: bool = Field(default=True, description="Extract and summarize tables")
    chunk_size: int = Field(default=1000, description="Size of text chunks")
    chunk_overlap: int = Field(default=200, description="Overlap between chunks")

class ProcessPDFRequest(BaseModel):
    """Request model for PDF processing"""
    pdf_url: str = Field(..., description="URL of the PDF to process")
    paper_title: str = Field(..., description="Title of the research paper")
    options: ProcessingOptions = Field(default_factory=ProcessingOptions)

class ChunkMetadata(BaseModel):
    """Metadata for a text chunk"""
    page_number: Optional[int] = None
    section: Optional[str] = None
    confidence: Optional[float] = None
    table_caption: Optional[str] = None
    image_caption: Optional[str] = None

class TextChunk(BaseModel):
    """A chunk of text from the document"""
    id: str = Field(..., description="Unique identifier for the chunk")
    text: str = Field(..., description="Text content of the chunk")
    type: str = Field(..., description="Type: text, table, or image")
    page_number: Optional[int] = None
    metadata: ChunkMetadata = Field(default_factory=ChunkMetadata)

class DocumentSummary(BaseModel):
    """Summary of the document"""
    abstract: str = Field(..., description="Abstract or summary of the document")
    key_findings: List[str] = Field(..., description="Key findings from the document")
    methodology: str = Field(..., description="Brief methodology description")
    conclusions: str = Field(..., description="Main conclusions")

class ProcessPDFResponse(BaseModel):
    """Response model for PDF processing"""
    success: bool = Field(..., description="Whether processing was successful")
    document_id: str = Field(..., description="Unique identifier for the processed document")
    chunks: List[TextChunk] = Field(..., description="Extracted text chunks")
    embeddings: List[List[float]] = Field(..., description="Embeddings for each chunk")
    summary: DocumentSummary = Field(..., description="Document summary")
    processing_time: float = Field(..., description="Processing time in seconds")

class SemanticSearchRequest(BaseModel):
    """Request model for semantic search"""
    query: str = Field(..., description="Search query")
    document_ids: Optional[List[str]] = Field(None, description="Specific documents to search")
    top_k: int = Field(default=5, description="Number of results to return")
    similarity_threshold: float = Field(default=0.7, description="Minimum similarity score")

class SearchResult(BaseModel):
    """A search result"""
    chunk_id: str = Field(..., description="ID of the matching chunk")
    document_id: str = Field(..., description="ID of the source document")
    text: str = Field(..., description="Text content of the chunk")
    similarity_score: float = Field(..., description="Similarity score (0-1)")
    type: str = Field(..., description="Type of content: text, table, or image")
    metadata: ChunkMetadata = Field(default_factory=ChunkMetadata)

class SemanticSearchResponse(BaseModel):
    """Response model for semantic search"""
    success: bool = Field(..., description="Whether search was successful")
    results: List[SearchResult] = Field(..., description="Search results")
    query_embedding: List[float] = Field(..., description="Embedding of the search query")
    search_time: float = Field(..., description="Search time in seconds")

class HealthResponse(BaseModel):
    """Health check response"""
    status: str = Field(..., description="Service status")
    gemini_status: str = Field(..., description="Gemini API status")
    uptime: int = Field(..., description="Service uptime in seconds")
    version: str = Field(..., description="API version")

class ErrorResponse(BaseModel):
    """Error response model"""
    success: bool = Field(default=False)
    error: Dict[str, Any] = Field(..., description="Error details")
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())
