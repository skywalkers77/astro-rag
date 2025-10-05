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


const app = new Hono();

app.post("/ingest", async (c) => {
	const { text, filename, pdfUrl, paperTitle } = await c.req.json();
	
	// Support both text and PDF ingestion
	if (!text && !pdfUrl) {
		return c.text("Missing text or pdfUrl", 400);
	}
	
	if (pdfUrl && !filename) {
		return c.text("Missing filename for PDF", 400);
	}
	
	// For PDF processing, forward to EC2 API
	if (pdfUrl) {
		try {
			const ec2Response = await fetch(`${c.env.EC2_API_URL}/api/process-pdf`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					pdf_url: pdfUrl,
					paper_title: paperTitle || filename,
					options: {
						extract_images: true,
						extract_tables: true,
						chunk_size: 1000,
						chunk_overlap: 200
					}
				})
			});
			
			if (!ec2Response.ok) {
				throw new Error(`EC2 API error: ${ec2Response.status}`);
			}
			
			const ec2Data = await ec2Response.json();
			
			// Process the chunks and embeddings from EC2
			await c.env.RAG_WORKFLOW.create({ 
				params: { 
					chunks: ec2Data.chunks,
					embeddings: ec2Data.embeddings,
					filename,
					pdfUrl,
					summary: ec2Data.summary
				} 
			});
			
			return c.json({
				message: `Processed PDF: ${filename}`,
				document_id: ec2Data.document_id,
				chunks_count: ec2Data.chunks.length,
				processing_time: ec2Data.processing_time
			}, 201);
			
		} catch (error) {
			console.error("EC2 API processing failed:", error);
			// Fallback to local processing
			await c.env.RAG_WORKFLOW.create({ 
				params: { 
					text, 
					filename, 
					pdfUrl 
				} 
			});
			return c.text(`Created PDF note (fallback): ${filename}`, 201);
		}
	}
	
	// For text-only ingestion, use existing workflow
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

app.get("/", async (c) => {
  const question = c.req.query("text") || "What is the square root of 9?";

  const embeddings = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: question,
  });
  
  const vectors = embeddings.data[0];

  const vectorQuery = await c.env.VECTORIZE.query(vectors, { topK: 1 });
  let vecId;
  if (
    vectorQuery.matches &&
    vectorQuery.matches.length > 0 &&
    vectorQuery.matches[0]
  ) {
    vecId = vectorQuery.matches[0].id;
  } else {
    console.log("No matching vector found or vectorQuery.matches is empty");
  }

  let notes = [];
  if (vecId) {
    const query = `SELECT * FROM pdfs WHERE id = ?`;
    const { results } = await c.env.database.prepare(query).bind(vecId).run();
    if (results) notes = results.map((vec) => vec.text);
  }

  const contextMessage = notes.length
    ? `Context:\n${notes.map((note) => `- ${note}`).join("\n")}`
    : "";

  const systemPrompt = `When answering the question or responding, use the context provided, if it is provided and relevant.`;

  const { response: answer } = await c.env.AI.run(
    "@cf/meta/llama-3-8b-instruct",
    {
      messages: [
        ...(notes.length ? [{ role: "system", content: contextMessage }] : []),
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    },
  );

  return c.text(answer);
});

app.onError((err, c) => {
  return c.text(err);
});

  
export default app;


export class RAGWorkflow extends WorkflowEntrypoint {
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
    const { text, filename, pdfUrl, chunks, embeddings, summary } = event.payload;
    
    console.log("RAGWorkflow started with payload:", { 
      text: text?.substring(0, 100), 
      filename, 
      pdfUrl, 
      hasChunks: !!chunks,
      hasEmbeddings: !!embeddings,
      hasSummary: !!summary
    });

    // Handle EC2-processed data or fallback to local processing
    const processedData = await step.do(`process data`, async () => {
      // If we have chunks from EC2, use them directly
      if (chunks && embeddings) {
        console.log(`Using EC2-processed data: ${chunks.length} chunks`);
        return {
          chunks: chunks,
          embeddings: embeddings,
          summary: summary
        };
      }
      
      // Fallback to local PDF processing
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
                return {
                  chunks: [{ id: '1', text: pdfText, type: 'text', page_number: 1 }],
                  embeddings: null, // Will be generated later
                  summary: null
                };
              }
            }
            
            // If we can't get the actual PDF, extract text from the HTML content
            const htmlText = await this.extractTextFromHtmlContent(pdfBuffer, filename);
            return {
              chunks: [{ id: '1', text: htmlText, type: 'text', page_number: 1 }],
              embeddings: null,
              summary: null
            };
          }
          
          // Use Cloudflare AI toMarkdown for proper PDF text extraction
          const pdfText = await this.extractTextWithCloudflareAI(pdfBuffer, filename, env);
          return {
            chunks: [{ id: '1', text: pdfText, type: 'text', page_number: 1 }],
            embeddings: null,
            summary: null
          };
          
        } catch (error) {
          console.error("Error processing PDF:", error);
          throw new Error(`Failed to process PDF: ${error.message}`);
        }
      }
      
      // For text-only input
      return {
        chunks: [{ id: '1', text: text, type: 'text', page_number: 1 }],
        embeddings: null,
        summary: null
      };
    });

    // Process each chunk and store in database
    const records = await step.do(`create database records`, async () => {
      try {
        const records = [];
        
        for (const chunk of processedData.chunks) {
          const query = "INSERT INTO pdfs (text, filename, pdf_url, chunk_id, chunk_type, page_number, metadata) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *";
          const filenameToStore = filename || null;
          const pdfUrlToStore = pdfUrl || null;
          const metadata = JSON.stringify(chunk.metadata || {});

          console.log("Inserting chunk into database:", { 
            chunkId: chunk.id, 
            textLength: chunk.text?.length, 
            type: chunk.type,
            pageNumber: chunk.page_number
          });

          const { results } = await env.database.prepare(query).bind(
            chunk.text, 
            filenameToStore, 
            pdfUrlToStore,
            chunk.id,
            chunk.type,
            chunk.page_number,
            metadata
          ).run();

          const record = results[0];
          if (!record) throw new Error(`Failed to create record for chunk ${chunk.id}`);
          
          records.push(record);
        }
        
        console.log(`Created ${records.length} database records`);
        return records;
      } catch (error) {
        console.error("Database insertion error:", error);
        throw error;
      }
    });

    // Generate embeddings for chunks that don't have them
    const finalEmbeddings = await step.do(`generate embeddings`, async () => {
      try {
        if (processedData.embeddings) {
          console.log("Using pre-generated embeddings from EC2");
          return processedData.embeddings;
        }
        
        console.log("Generating embeddings for chunks");
        
        // Use LangChain with Gemini embeddings for ingestion
        const embeddings = new GoogleGenerativeAIEmbeddings({
          model: "text-embedding-004", // Latest and best Gemini embedding model
          apiKey: env.GOOGLE_API_KEY,
        });

        const chunkEmbeddings = [];
        for (const chunk of processedData.chunks) {
          const values = await embeddings.embedQuery(chunk.text);
          if (!values) throw new Error(`Failed to generate vector embedding for chunk ${chunk.id}`);
          chunkEmbeddings.push(values);
        }
        
        console.log(`Generated ${chunkEmbeddings.length} embeddings, dimensions:`, chunkEmbeddings[0]?.length);
        return chunkEmbeddings;
      } catch (error) {
        console.error("Embedding generation error:", error);
        throw error;
      }
    });

    // Insert vectors for each chunk
    await step.do(`insert vectors`, async () => {
      const vectorData = records.map((record, index) => ({
        id: record.id.toString(),
        values: finalEmbeddings[index],
      }));
      
      console.log(`Inserting ${vectorData.length} vectors into Vectorize`);
      return env.VECTORIZE.upsert(vectorData);
    });
  }
}

