"""
PDF processing service for text, image, and table extraction
"""

import os
import logging
import asyncio
from typing import List, Dict, Any, Optional
import aiohttp
import fitz  # PyMuPDF
import pandas as pd
from PIL import Image
import io
import uuid

from models.schemas import TextChunk, ChunkMetadata

logger = logging.getLogger(__name__)

class PDFProcessor:
    def __init__(self):
        self.max_file_size = int(os.getenv("MAX_FILE_SIZE", "50")) * 1024 * 1024  # 50MB default
        
    async def process_pdf(
        self, 
        pdf_url: str, 
        extract_images: bool = True,
        extract_tables: bool = True,
        chunk_size: int = 1000,
        chunk_overlap: int = 200
    ) -> 'ProcessedContent':
        """Process PDF and extract text, images, and tables"""
        try:
            # Download PDF
            pdf_buffer = await self._download_pdf(pdf_url)
            
            # Open PDF with PyMuPDF
            pdf_document = fitz.open(stream=pdf_buffer, filetype="pdf")
            
            chunks = []
            
            for page_num in range(len(pdf_document)):
                page = pdf_document[page_num]
                
                # Extract text
                text_chunks = await self._extract_text_chunks(
                    page, page_num, chunk_size, chunk_overlap
                )
                chunks.extend(text_chunks)
                
                # Extract images if requested
                if extract_images:
                    image_chunks = await self._extract_images(page, page_num)
                    chunks.extend(image_chunks)
                
                # Extract tables if requested
                if extract_tables:
                    table_chunks = await self._extract_tables(page, page_num)
                    chunks.extend(table_chunks)
            
            pdf_document.close()
            
            return ProcessedContent(chunks=chunks)
            
        except Exception as e:
            logger.error(f"PDF processing failed: {e}")
            raise Exception(f"Failed to process PDF: {str(e)}")
    
    async def _download_pdf(self, pdf_url: str) -> bytes:
        """Download PDF from URL"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(pdf_url) as response:
                    if response.status != 200:
                        raise Exception(f"Failed to download PDF: {response.status}")
                    
                    content_length = response.headers.get('content-length')
                    if content_length and int(content_length) > self.max_file_size:
                        raise Exception(f"PDF too large: {content_length} bytes")
                    
                    pdf_buffer = await response.read()
                    
                    if len(pdf_buffer) > self.max_file_size:
                        raise Exception(f"PDF too large: {len(pdf_buffer)} bytes")
                    
                    return pdf_buffer
                    
        except Exception as e:
            logger.error(f"PDF download failed: {e}")
            raise Exception(f"Failed to download PDF: {str(e)}")
    
    async def _extract_text_chunks(
        self, 
        page, 
        page_num: int, 
        chunk_size: int, 
        chunk_overlap: int
    ) -> List[TextChunk]:
        """Extract and chunk text from a page"""
        try:
            text = page.get_text()
            if not text.strip():
                return []
            
            # Split text into chunks
            chunks = []
            words = text.split()
            
            for i in range(0, len(words), chunk_size - chunk_overlap):
                chunk_words = words[i:i + chunk_size]
                chunk_text = " ".join(chunk_words)
                
                if chunk_text.strip():
                    chunk = TextChunk(
                        id=str(uuid.uuid4()),
                        text=chunk_text,
                        type="text",
                        page_number=page_num + 1,
                        metadata=ChunkMetadata(
                            page_number=page_num + 1,
                            confidence=0.9
                        )
                    )
                    chunks.append(chunk)
            
            return chunks
            
        except Exception as e:
            logger.error(f"Text extraction failed for page {page_num}: {e}")
            return []
    
    async def _extract_images(self, page, page_num: int) -> List[TextChunk]:
        """Extract images from a page"""
        try:
            chunks = []
            image_list = page.get_images()
            
            for img_index, img in enumerate(image_list):
                try:
                    # Get image data
                    xref = img[0]
                    pix = fitz.Pixmap(page.parent, xref)
                    
                    if pix.n - pix.alpha < 4:  # GRAY or RGB
                        img_data = pix.tobytes("png")
                        
                        # Create image description (in a real implementation, you'd use OCR or vision AI)
                        chunk = TextChunk(
                            id=str(uuid.uuid4()),
                            text=f"Image {img_index + 1} on page {page_num + 1}: [Image content extracted]",
                            type="image",
                            page_number=page_num + 1,
                            metadata=ChunkMetadata(
                                page_number=page_num + 1,
                                confidence=0.8,
                                image_caption=f"Figure {img_index + 1}"
                            )
                        )
                        chunks.append(chunk)
                    
                    pix = None
                    
                except Exception as e:
                    logger.error(f"Failed to extract image {img_index} from page {page_num}: {e}")
                    continue
            
            return chunks
            
        except Exception as e:
            logger.error(f"Image extraction failed for page {page_num}: {e}")
            return []
    
    async def _extract_tables(self, page, page_num: int) -> List[TextChunk]:
        """Extract tables from a page"""
        try:
            chunks = []
            tables = page.find_tables()
            
            for table_index, table in enumerate(tables):
                try:
                    # Extract table data
                    table_data = table.extract()
                    
                    if table_data and len(table_data) > 1:  # Has header and data
                        # Convert to pandas DataFrame for better processing
                        df = pd.DataFrame(table_data[1:], columns=table_data[0])
                        
                        # Create table description
                        table_text = f"Table {table_index + 1} on page {page_num + 1}:\n"
                        table_text += f"Columns: {', '.join(df.columns)}\n"
                        table_text += f"Rows: {len(df)}\n"
                        table_text += f"Data preview: {df.head(3).to_string()}"
                        
                        chunk = TextChunk(
                            id=str(uuid.uuid4()),
                            text=table_text,
                            type="table",
                            page_number=page_num + 1,
                            metadata=ChunkMetadata(
                                page_number=page_num + 1,
                                confidence=0.85,
                                table_caption=f"Table {table_index + 1}"
                            )
                        )
                        chunks.append(chunk)
                
                except Exception as e:
                    logger.error(f"Failed to extract table {table_index} from page {page_num}: {e}")
                    continue
            
            return chunks
            
        except Exception as e:
            logger.error(f"Table extraction failed for page {page_num}: {e}")
            return []

class ProcessedContent:
    """Container for processed PDF content"""
    def __init__(self, chunks: List[TextChunk]):
        self.chunks = chunks
