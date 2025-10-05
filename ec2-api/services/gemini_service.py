"""
Gemini 1.5 Flash service for text processing and summarization
"""

import os
import logging
from typing import List, Dict, Any
import google.generativeai as genai
from models.schemas import TextChunk, DocumentSummary

logger = logging.getLogger(__name__)

class GeminiService:
    def __init__(self):
        self.api_key = os.getenv("GOOGLE_API_KEY")
        if not self.api_key:
            raise ValueError("GOOGLE_API_KEY environment variable is required")
        
        genai.configure(api_key=self.api_key)
        self.model = genai.GenerativeModel('gemini-1.5-flash')
        
    async def test_connection(self) -> str:
        """Test connection to Gemini API"""
        try:
            response = self.model.generate_content("Hello, test connection")
            return "connected" if response else "disconnected"
        except Exception as e:
            logger.error(f"Gemini connection test failed: {e}")
            return "error"
    
    async def generate_summary(self, chunks: List[TextChunk], paper_title: str) -> DocumentSummary:
        """Generate document summary using Gemini"""
        try:
            # Combine chunks for summary generation
            text_content = "\n\n".join([chunk.text for chunk in chunks])
            
            prompt = f"""
            Please analyze this research paper titled "{paper_title}" and provide a comprehensive summary.
            
            Paper content:
            {text_content}
            
            Please provide:
            1. A concise abstract (2-3 sentences)
            2. Key findings (3-5 bullet points)
            3. Brief methodology description (1-2 sentences)
            4. Main conclusions (2-3 sentences)
            
            Format your response as JSON with the following structure:
            {{
                "abstract": "Brief abstract...",
                "key_findings": ["Finding 1", "Finding 2", "Finding 3"],
                "methodology": "Brief methodology...",
                "conclusions": "Main conclusions..."
            }}
            """
            
            response = self.model.generate_content(prompt)
            
            # Parse JSON response
            import json
            summary_data = json.loads(response.text)
            
            return DocumentSummary(
                abstract=summary_data.get("abstract", ""),
                key_findings=summary_data.get("key_findings", []),
                methodology=summary_data.get("methodology", ""),
                conclusions=summary_data.get("conclusions", "")
            )
            
        except Exception as e:
            logger.error(f"Summary generation failed: {e}")
            # Return fallback summary
            return DocumentSummary(
                abstract=f"Summary of {paper_title}",
                key_findings=["Key findings could not be extracted"],
                methodology="Methodology details not available",
                conclusions="Conclusions could not be extracted"
            )
    
    async def summarize_table(self, table_text: str) -> str:
        """Summarize table content using Gemini"""
        try:
            prompt = f"""
            Please analyze this table and provide a concise summary of its key insights:
            
            Table content:
            {table_text}
            
            Provide a 2-3 sentence summary focusing on the main trends, patterns, or key data points.
            """
            
            response = self.model.generate_content(prompt)
            return response.text.strip()
            
        except Exception as e:
            logger.error(f"Table summarization failed: {e}")
            return f"Table summary unavailable: {str(e)}"
    
    async def describe_image(self, image_description: str) -> str:
        """Generate image description using Gemini"""
        try:
            prompt = f"""
            Please analyze this image description and provide a detailed explanation:
            
            Image description:
            {image_description}
            
            Provide a 2-3 sentence description focusing on what the image shows and its relevance to the research.
            """
            
            response = self.model.generate_content(prompt)
            return response.text.strip()
            
        except Exception as e:
            logger.error(f"Image description failed: {e}")
            return f"Image description unavailable: {str(e)}"
    
    async def enhance_chunk(self, chunk_text: str, chunk_type: str) -> str:
        """Enhance chunk text using Gemini for better context"""
        try:
            if chunk_type == "table":
                return await self.summarize_table(chunk_text)
            elif chunk_type == "image":
                return await self.describe_image(chunk_text)
            else:
                # For text chunks, just return as-is or add minimal enhancement
                return chunk_text
                
        except Exception as e:
            logger.error(f"Chunk enhancement failed: {e}")
            return chunk_text
