-- Migration to add chunk-related fields to the pdfs table
-- This supports the new hybrid architecture with EC2 processing

-- Add new columns for chunk support
ALTER TABLE pdfs ADD COLUMN chunk_id TEXT;
ALTER TABLE pdfs ADD COLUMN chunk_type TEXT DEFAULT 'text';
ALTER TABLE pdfs ADD COLUMN page_number INTEGER;
ALTER TABLE pdfs ADD COLUMN metadata TEXT; -- JSON string for additional metadata

-- Create index on chunk_id for faster lookups
CREATE INDEX idx_pdfs_chunk_id ON pdfs(chunk_id);

-- Create index on chunk_type for filtering by content type
CREATE INDEX idx_pdfs_chunk_type ON pdfs(chunk_type);

-- Create index on page_number for page-based queries
CREATE INDEX idx_pdfs_page_number ON pdfs(page_number);

-- Update existing records to have default values
UPDATE pdfs SET chunk_id = 'legacy_' || id WHERE chunk_id IS NULL;
UPDATE pdfs SET chunk_type = 'text' WHERE chunk_type IS NULL;
UPDATE pdfs SET page_number = 1 WHERE page_number IS NULL;
UPDATE pdfs SET metadata = '{}' WHERE metadata IS NULL;
