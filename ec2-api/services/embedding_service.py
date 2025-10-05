"""
Embedding service using Google Generative AI
"""

import os
import logging
from typing import List
import google.generativeai as genai

logger = logging.getLogger(__name__)

class EmbeddingService:
    def __init__(self):
        self.api_key = os.getenv("GOOGLE_API_KEY")
        if not self.api_key:
            raise ValueError("GOOGLE_API_KEY environment variable is required")
        
        genai.configure(api_key=self.api_key)
        self.model = "text-embedding-004"  # Latest Gemini embedding model
        
    async def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text using Gemini"""
        try:
            # Use Gemini's embedding model
            result = genai.embed_content(
                model=self.model,
                content=text,
                task_type="retrieval_document"  # or "retrieval_query" for queries
            )
            
            return result['embedding']
            
        except Exception as e:
            logger.error(f"Embedding generation failed: {e}")
            # Fallback to a simple hash-based embedding (not recommended for production)
            return self._fallback_embedding(text)
    
    def _fallback_embedding(self, text: str) -> List[float]:
        """Fallback embedding method (not recommended for production)"""
        import hashlib
        import struct
        
        # Create a simple hash-based embedding
        hash_obj = hashlib.sha256(text.encode())
        hash_bytes = hash_obj.digest()
        
        # Convert to 768-dimensional vector (common embedding size)
        embedding = []
        for i in range(0, len(hash_bytes), 4):
            if len(embedding) >= 768:
                break
            chunk = hash_bytes[i:i+4]
            if len(chunk) == 4:
                value = struct.unpack('>I', chunk)[0] / (2**32)  # Normalize to 0-1
                embedding.append(value)
        
        # Pad or truncate to exactly 768 dimensions
        while len(embedding) < 768:
            embedding.append(0.0)
        
        return embedding[:768]
    
    async def generate_query_embedding(self, query: str) -> List[float]:
        """Generate embedding for search query"""
        try:
            result = genai.embed_content(
                model=self.model,
                content=query,
                task_type="retrieval_query"
            )
            
            return result['embedding']
            
        except Exception as e:
            logger.error(f"Query embedding generation failed: {e}")
            return self._fallback_embedding(query)
