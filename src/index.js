/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 * 
 */

import { Hono } from "hono";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { answerQuery } from "../queryHandling.js";


const app = new Hono();

app.post("/ingest", async (c) => {
  const { text, filename, pdfUrl } = await c.req.json();

  // Support both text and PDF ingestion
  if (!text && !pdfUrl) {
    return c.text("Missing text or pdfUrl", 400);
  }

  if (pdfUrl && !filename) {
    return c.text("Missing filename for PDF", 400);
  }

  await c.env.RAG_WORKFLOW.create({
    params: {
      text,
      filename,
      pdfUrl
    }
  });

  const message = pdfUrl ? `Created PDF note: ${filename}` : "Created note";
  return c.text(message, 201);
});

// Endpoint to get chunking information and statistics
app.get("/chunks", async (c) => {
  try {
    const filename = c.req.query("filename");
    let query = "SELECT filename, COUNT(*) as chunk_count, AVG(chunk_size) as avg_chunk_size, MIN(chunk_index) as min_chunk, MAX(chunk_index) as max_chunk FROM pdfs";
    let params = [];

    if (filename) {
      query += " WHERE filename = ?";
      params.push(filename);
    }

    query += " GROUP BY filename ORDER BY filename";

    const { results } = await c.env.database.prepare(query).bind(...params).run();

    if (!results || results.length === 0) {
      return c.json({ message: "No chunks found", chunks: [] });
    }

    return c.json({
      message: "Chunk statistics retrieved successfully",
      total_files: results.length,
      chunks: results
    });
  } catch (error) {
    console.error("Error retrieving chunk statistics:", error);
    return c.text(`Error retrieving chunk statistics: ${error.message}`, 500);
  }
});

// Endpoint to get specific chunks for a document
app.get("/chunks/:filename", async (c) => {
  try {
    const filename = c.req.param("filename");
    const chunkIndex = c.req.query("chunkIndex");

    let query = "SELECT * FROM pdfs WHERE filename = ?";
    let params = [filename];

    if (chunkIndex !== undefined) {
      query += " AND chunk_index = ?";
      params.push(parseInt(chunkIndex));
    }

    query += " ORDER BY chunk_index ASC";

    const { results } = await c.env.database.prepare(query).bind(...params).run();

    if (!results || results.length === 0) {
      return c.json({ message: `No chunks found for filename: ${filename}`, chunks: [] });
    }

    return c.json({
      message: `Retrieved chunks for ${filename}`,
      filename: filename,
      total_chunks: results.length,
      chunks: results
    });
  } catch (error) {
    console.error("Error retrieving chunks:", error);
    return c.text(`Error retrieving chunks: ${error.message}`, 500);
  }
});

// Main query endpoint using the new query handling system
app.get("/query", async (c) => {
  try {
    const question = c.req.query("text") || "What is the square root of 9?";
    const mode = c.req.query("mode") || "hybrid"; // "db-only" or "hybrid"
    const topK = parseInt(c.req.query("topK")) || 8;
    const scoreThreshold = parseFloat(c.req.query("scoreThreshold")) || 0.72;

    console.log(`Processing query: "${question}" with mode: ${mode}`);

    const result = await answerQuery(question, mode, topK, scoreThreshold, c.env);

    // Format response with sources and doc IDs
    const response = {
      query: question,
      answer: result.answer,
      sources: result.provenance || [],
      mode: mode,
      timestamp: new Date().toISOString()
    };

    // If provenance exists, add source details
    if (result.provenance && result.provenance.length > 0) {
      response.sourceDetails = result.provenance.map(source => ({
        docId: source.id,
        source: source.source,
        score: source.score,
        relevance: source.score > 0.8 ? "High" : source.score > 0.6 ? "Medium" : "Low"
      }));
    }

    return c.json(response);
  } catch (error) {
    console.error("Error processing query:", error);
    return c.json({
      error: "Failed to process query",
      message: error.message
    }, 500);
  }
});

app.onError((err, c) => {
  return c.text(err);
});


export default app;


export class RAGWorkflow extends WorkflowEntrypoint {
  // Text chunking utility functions
  chunkText(text, chunkSize = 1000, overlap = 200) {
    if (!text || text.length <= chunkSize) {
      return [text];
    }

    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = start + chunkSize;

      // If this isn't the last chunk, try to break at a sentence or word boundary
      if (end < text.length) {
        // Look for sentence endings within the last 100 characters
        const sentenceEnd = text.lastIndexOf('.', end);
        const questionEnd = text.lastIndexOf('?', end);
        const exclamationEnd = text.lastIndexOf('!', end);

        const lastSentenceEnd = Math.max(sentenceEnd, questionEnd, exclamationEnd);

        if (lastSentenceEnd > start + chunkSize * 0.7) {
          end = lastSentenceEnd + 1;
        } else {
          // Look for word boundaries
          const lastSpace = text.lastIndexOf(' ', end);
          if (lastSpace > start + chunkSize * 0.8) {
            end = lastSpace;
          }
        }
      }

      const chunk = text.slice(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      // Move start position with overlap
      start = end - overlap;
      if (start >= text.length) break;
    }

    return chunks;
  }

  // Enhanced chunking with metadata preservation
  chunkTextWithMetadata(text, filename, chunkSize = 1000, overlap = 200) {
    const chunks = this.chunkText(text, chunkSize, overlap);

    return chunks.map((chunk, index) => ({
      text: chunk,
      metadata: {
        filename,
        chunkIndex: index,
        totalChunks: chunks.length,
        chunkSize: chunk.length,
        originalTextLength: text.length
      }
    }));
  }

  // Helper method to get actual PDF URL from NCBI viewer URLs
  async getActualPdfUrl(viewerUrl) {
    try {
      // For NCBI PMC URLs, try to construct the direct PDF URL
      if (viewerUrl.includes('pmc.ncbi.nlm.nih.gov')) {
        // Extract PMC ID from URL
        const pmcMatch = viewerUrl.match(/PMC(\d+)/);
        if (pmcMatch) {
          const pmcId = pmcMatch[1];

          // Try different direct PDF URL formats
          const possibleUrls = [

            `https://europepmc.org/articles/PMC${pmcId}/pdf/PMC${pmcId}.pdf`,



          ];

          // Test each URL to see which one returns actual PDF content
          for (const url of possibleUrls) {
            try {
              console.log(`Testing PDF URL: ${url}`);
              const testResponse = await fetch(url, { method: 'HEAD' });
              const contentType = testResponse.headers.get('content-type') || '';

              if (contentType.includes('application/pdf')) {
                console.log(`Found valid PDF URL: ${url}`);
                return url;
              }
            } catch (error) {
              console.log(`URL ${url} failed:`, error.message);
            }
          }
        }
      }
      return null;
    } catch (error) {
      console.error('Error getting actual PDF URL:', error);
      return null;
    }
  }

  // Extract text from HTML content (fallback for NCBI viewer pages)
  async extractTextFromHtmlContent(htmlBuffer, filename) {
    try {
      const htmlContent = new TextDecoder('utf-8', { fatal: false }).decode(htmlBuffer);

      // Extract text content from HTML
      let extractedText = htmlContent
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
        .replace(/<[^>]+>/g, ' ') // Remove HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      // Clean up common HTML artifacts
      extractedText = extractedText
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

      const bufferSize = htmlBuffer.byteLength;
      const sizeInMB = (bufferSize / (1024 * 1024)).toFixed(2);

      if (extractedText.length < 100) {
        return `Document: ${filename}
File Size: ${sizeInMB} MB

This appears to be a PDF viewer page rather than the actual PDF content. The extracted text is minimal, which suggests this is an HTML page that displays the PDF rather than the PDF file itself.

To get better results, you may need to:
1. Find the direct PDF download link
2. Use a different PDF source
3. Contact the publisher for the actual PDF file

Extracted content: ${extractedText}`;
      }

      return `Document: ${filename}
File Size: ${sizeInMB} MB
Note: This content was extracted from an HTML viewer page, not the actual PDF file.

Extracted Text:

${extractedText}`;
    } catch (error) {
      console.error('Error extracting text from HTML:', error);
      return `Document: ${filename}\n\nError extracting text from HTML content: ${error.message}`;
    }
  }

  // Extract text using Cloudflare AI toMarkdown
  async extractTextWithCloudflareAI(pdfBuffer, filename, env) {
    try {
      const bufferSize = pdfBuffer.byteLength;
      const sizeInMB = (bufferSize / (1024 * 1024)).toFixed(2);

      console.log(`Processing PDF with Cloudflare AI toMarkdown: ${filename} (${sizeInMB} MB)`);

      // Convert buffer to blob for Cloudflare AI
      const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });

      // Use Cloudflare AI toMarkdown to extract text
      const documents = [{ name: filename, blob: pdfBlob }];
      const results = await env.AI.toMarkdown(documents);

      if (results && results.length > 0 && results[0].data) {
        const extractedText = results[0].data;
        console.log(`Successfully extracted ${extractedText.length} characters using Cloudflare AI`);

        return `Document: ${filename}
File Size: ${sizeInMB} MB
Extracted Text:

${extractedText}`;
      } else {
        throw new Error("No text extracted from PDF using Cloudflare AI");
      }
    } catch (error) {
      console.error("Cloudflare AI PDF extraction failed:", error);
      // Fallback to custom extraction
      return await this.extractTextFromPDFBuffer(pdfBuffer, filename);
    }
  }

  // Enhanced PDF text extraction method
  async extractTextFromPDFBuffer(pdfBuffer, filename) {
    try {
      const bufferSize = pdfBuffer.byteLength;
      const sizeInMB = (bufferSize / (1024 * 1024)).toFixed(2);

      // Convert buffer to string for text extraction
      const uint8Array = new Uint8Array(pdfBuffer);
      const textDecoder = new TextDecoder('utf-8', { fatal: false });
      const pdfString = textDecoder.decode(uint8Array);

      let extractedText = '';

      // Method 1: Extract text from PDF text objects (BT...ET blocks)
      const textBlocks = pdfString.match(/BT[\s\S]*?ET/g);
      if (textBlocks && textBlocks.length > 0) {
        for (const block of textBlocks) {
          // Extract text from various PDF text operators
          const textMatches = block.match(/\((.*?)\)/g);
          if (textMatches) {
            for (const match of textMatches) {
              const text = match.slice(1, -1)
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\t/g, '\t')
                .replace(/\\\(/g, '(')
                .replace(/\\\)/g, ')')
                .replace(/\\\\/g, '\\')
                .replace(/\\[0-9]{3}/g, (match) => String.fromCharCode(parseInt(match.slice(1), 8)))
                .trim();

              if (text && text.length > 1) {
                extractedText += text + ' ';
              }
            }
          }
        }
      }

      // Method 2: Extract text from PDF streams
      const streamMatches = pdfString.match(/stream[\s\S]*?endstream/g);
      if (streamMatches && streamMatches.length > 0) {
        for (const stream of streamMatches) {
          // Look for text patterns in streams
          const streamText = stream.match(/[A-Za-z0-9\s.,!?;:'"()\-]{20,}/g);
          if (streamText) {
            extractedText += streamText.join(' ') + ' ';
          }
        }
      }

      // Method 3: Extract text from PDF content streams
      const contentMatches = pdfString.match(/\/Contents\s*<<[^>]*>>[\s\S]*?stream[\s\S]*?endstream/g);
      if (contentMatches && contentMatches.length > 0) {
        for (const content of contentMatches) {
          const contentText = content.match(/[A-Za-z0-9\s.,!?;:'"()\-]{15,}/g);
          if (contentText) {
            extractedText += contentText.join(' ') + ' ';
          }
        }
      }

      // Method 4: Extract text from PDF objects
      const objectMatches = pdfString.match(/obj[\s\S]*?endobj/g);
      if (objectMatches && objectMatches.length > 0) {
        for (const obj of objectMatches) {
          // Look for text patterns in objects
          const objText = obj.match(/[A-Za-z0-9\s.,!?;:'"()\-]{25,}/g);
          if (objText) {
            extractedText += objText.join(' ') + ' ';
          }
        }
      }

      // Method 5: Fallback - extract any readable text patterns
      if (!extractedText.trim()) {
        const readableText = pdfString.match(/[A-Za-z0-9\s.,!?;:'"()\-]{30,}/g);
        if (readableText) {
          extractedText = readableText.join(' ');
        }
      }

      // Clean up the extracted text
      extractedText = extractedText
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .replace(/\n\s*\n/g, '\n') // Remove empty lines
        .replace(/[^\x20-\x7E\n\r]/g, '') // Remove non-printable characters
        .trim();

      // If we still don't have meaningful text, provide a fallback
      if (!extractedText || extractedText.length < 50) {
        extractedText = `Document: ${filename}
File Size: ${sizeInMB} MB

This PDF document appears to be image-based or contains minimal extractable text. The document was successfully processed but no readable text content could be extracted. This commonly occurs with:

- Scanned documents (image-based PDFs)
- PDFs with complex layouts
- Password-protected or encrypted PDFs
- PDFs with embedded images containing text

For better text extraction, consider using OCR (Optical Character Recognition) services or specialized PDF processing tools.`;
      } else {
        // Add document metadata to the extracted text
        extractedText = `Document: ${filename}
File Size: ${sizeInMB} MB
Extracted Text:

${extractedText}`;
      }

      console.log(`PDF text extraction completed. Extracted ${extractedText.length} characters.`);
      return extractedText;
    } catch (error) {
      console.error("Error in PDF text extraction:", error);
      return `Document: ${filename}\n\nError extracting text from PDF: ${error.message}. Please ensure the PDF is readable and not corrupted.`;
    }
  }

  async run(event, step) {
    const env = this.env;
    const { text, filename, pdfUrl } = event.payload;

    console.log("RAGWorkflow started with payload:", { text: text?.substring(0, 100), filename, pdfUrl });

    // Extract text from PDF if pdfUrl is provided
    const extractedText = await step.do(`extract text from PDF`, async () => {
      if (pdfUrl) {
        try {
          // Fetch the PDF from the URL
          const response = await fetch(pdfUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
          }

          // Check if we got HTML instead of PDF
          const contentType = response.headers.get('content-type') || '';
          const contentDisposition = response.headers.get('content-disposition') || '';

          console.log('Response headers:', { contentType, contentDisposition });

          const pdfBuffer = await response.arrayBuffer();

          // Check if the content is actually HTML (NCBI viewer page)
          const textDecoder = new TextDecoder('utf-8', { fatal: false });
          const contentPreview = textDecoder.decode(pdfBuffer.slice(0, 1000));

          if (contentPreview.includes('<html') || contentPreview.includes('<!DOCTYPE') ||
            contentType.includes('text/html') || contentPreview.includes('viewport')) {
            console.log('Detected HTML content instead of PDF, trying alternative approach...');

            // Try to get the actual PDF by modifying the URL
            const actualPdfUrl = await this.getActualPdfUrl(pdfUrl);
            if (actualPdfUrl && actualPdfUrl !== pdfUrl) {
              console.log('Trying actual PDF URL:', actualPdfUrl);
              const actualResponse = await fetch(actualPdfUrl);
              if (actualResponse.ok) {
                const actualPdfBuffer = await actualResponse.arrayBuffer();
                const pdfText = await this.extractTextWithCloudflareAI(actualPdfBuffer, filename, env);
                return pdfText;
              }
            }

            // If we can't get the actual PDF, extract text from the HTML content
            return await this.extractTextFromHtmlContent(pdfBuffer, filename);
          }

          // Use Cloudflare AI toMarkdown for proper PDF text extraction
          const pdfText = await this.extractTextWithCloudflareAI(pdfBuffer, filename, env);
          return pdfText;

        } catch (error) {
          console.error("Error processing PDF:", error);
          throw new Error(`Failed to process PDF: ${error.message}`);
        }
      }
      return text;
    });

    // Chunk the extracted text with larger chunks to reduce API calls
    const chunks = await step.do(`chunk text`, async () => {
      const filenameToStore = filename || 'untitled';
      const chunkedData = this.chunkTextWithMetadata(extractedText, filenameToStore, 8000, 500);
      console.log(`Text chunked into ${chunkedData.length} chunks (8k chunks to minimize API calls)`);
      return chunkedData;
    });

    // Create database records for each chunk
    const records = await step.do(`create database records for chunks`, async () => {
      try {
        const records = [];
        const pdfUrlToStore = pdfUrl || null;

        for (const chunkData of chunks) {
          const query = "INSERT INTO pdfs (text, filename, pdf_url, chunk_index, total_chunks, chunk_size, original_text_length) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *";

          console.log("Inserting chunk into database:", {
            chunkText: chunkData.text?.substring(0, 100),
            filename: chunkData.metadata.filename,
            chunkIndex: chunkData.metadata.chunkIndex,
            totalChunks: chunkData.metadata.totalChunks
          });

          const { results } = await env.database.prepare(query).bind(
            chunkData.text,
            chunkData.metadata.filename,
            pdfUrlToStore,
            chunkData.metadata.chunkIndex,
            chunkData.metadata.totalChunks,
            chunkData.metadata.chunkSize,
            chunkData.metadata.originalTextLength
          ).run();

          const record = results[0];
          if (!record) throw new Error("Failed to create chunk record - no record returned");

          records.push(record);
        }

        console.log(`Created ${records.length} database records for chunks`);
        return records;
      } catch (error) {
        console.error("Database insertion error:", error);
        throw error;
      }
    });

    // Generate embeddings for each chunk
    const embeddings = await step.do(`generate embeddings for chunks`, async () => {
      try {
        console.log(`Generating embeddings for ${chunks.length} chunks`);

        // Use LangChain with Gemini embeddings for ingestion
        const embeddingModel = new GoogleGenerativeAIEmbeddings({
          model: "text-embedding-004", // Latest and best Gemini embedding model
        });

        const chunkEmbeddings = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          console.log(`Generating embedding for chunk ${i + 1}/${chunks.length}:`, chunk.text?.substring(0, 100));

          // Generate embeddings for each chunk
          const values = await embeddingModel.embedQuery(chunk.text);
          if (!values) throw new Error(`Failed to generate vector embedding for chunk ${i + 1}`);

          chunkEmbeddings.push({
            id: records[i].id.toString(),
            values: values,
            chunkIndex: chunk.metadata.chunkIndex,
            filename: chunk.metadata.filename
          });
        }

        console.log(`Embeddings generated successfully for ${chunkEmbeddings.length} chunks, dimensions:`, chunkEmbeddings[0]?.values.length);
        return chunkEmbeddings;
      } catch (error) {
        console.error("Embedding generation error:", error);
        throw error;
      }
    });

    // Insert vectors for all chunks
    await step.do(`insert vectors for all chunks`, async () => {
      try {
        const vectorData = embeddings.map(embedding => ({
          id: embedding.id,
          values: embedding.values,
        }));

        console.log(`Inserting ${vectorData.length} vectors into Vectorize`);
        return await env.VECTORIZE.upsert(vectorData);
      } catch (error) {
        console.error("Vector insertion error:", error);
        throw error;
      }
    });
  }
}

