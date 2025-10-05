# Hybrid RAG Architecture Deployment Guide

## Overview
This guide covers deploying the hybrid RAG architecture with Cloudflare Workers + EC2 Python API for advanced PDF processing, semantic search, and summarization using Gemini 1.5 Flash.

## Architecture Components

### 1. Cloudflare Workers (Edge)
- **Role**: Fast edge processing, embeddings, vector storage, user queries
- **Services**: Vectorize, D1 Database, AI bindings
- **Location**: Global edge network

### 2. EC2 Python API (Compute)
- **Role**: Heavy PDF processing, semantic search, image/table extraction
- **Services**: Gemini 1.5 Flash, PyMuPDF, FastAPI
- **Location**: AWS EC2 instance

## Deployment Steps

### Step 1: Deploy EC2 Python API

#### 1.1 Launch EC2 Instance
```bash
# Launch t3.large or larger instance
# Ubuntu 22.04 LTS recommended
# Security group: Allow inbound on port 8000
```

#### 1.2 Install Dependencies
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python 3.11
sudo apt install python3.11 python3.11-pip python3.11-venv -y

# Install system dependencies for PDF processing
sudo apt install -y \
    libpoppler-cpp-dev \
    libpoppler-dev \
    poppler-utils \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1
```

#### 1.3 Deploy Application
```bash
# Clone your repository
git clone <your-repo-url>
cd rag-ai-tutorial/ec2-api

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export GOOGLE_API_KEY="your-gemini-api-key"
export REDIS_URL="redis://localhost:6379"  # Optional
export MAX_FILE_SIZE="50"
export CHUNK_SIZE="1000"
export CHUNK_OVERLAP="200"

# Run the application
uvicorn main:app --host 0.0.0.0 --port 8000
```

#### 1.4 Setup as Service (Optional)
```bash
# Create systemd service
sudo nano /etc/systemd/system/rag-api.service
```

```ini
[Unit]
Description=RAG Processing API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/rag-ai-tutorial/ec2-api
Environment=GOOGLE_API_KEY=your-gemini-api-key
Environment=REDIS_URL=redis://localhost:6379
ExecStart=/home/ubuntu/rag-ai-tutorial/ec2-api/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl enable rag-api
sudo systemctl start rag-api
sudo systemctl status rag-api
```

### Step 2: Update Cloudflare Workers

#### 2.1 Update Environment Variables
```bash
# Update wrangler.jsonc with your EC2 URL
# Replace "https://your-ec2-instance.com:8000" with your actual EC2 public IP/DNS
```

#### 2.2 Run Database Migration
```bash
# Apply the new migration
wrangler d1 execute database --file=./migrations/0002_add_chunk_fields.sql
```

#### 2.3 Deploy Workers
```bash
# Deploy the updated worker
npm run deploy
```

### Step 3: Configure Security

#### 3.1 EC2 Security Group
```bash
# Allow inbound traffic on port 8000 from Cloudflare IPs
# Or restrict to your specific IP ranges
```

#### 3.2 API Authentication (Recommended)
```python
# Add to your EC2 API
from fastapi import HTTPException, Depends, Header

async def verify_api_key(x_api_key: str = Header(None)):
    if x_api_key != "your-secret-api-key":
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key

# Use in endpoints
@app.post("/api/process-pdf")
async def process_pdf(request: ProcessPDFRequest, api_key: str = Depends(verify_api_key)):
    # ... your code
```

#### 3.3 Update Workers to Include API Key
```javascript
// In your Workers code
const ec2Response = await fetch(`${c.env.EC2_API_URL}/api/process-pdf`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-API-Key': c.env.EC2_API_KEY  // Add this secret
    },
    body: JSON.stringify({...})
});
```

### Step 4: Testing

#### 4.1 Test EC2 API Directly
```bash
# Health check
curl http://your-ec2-ip:8000/api/health

# Test PDF processing
curl -X POST http://your-ec2-ip:8000/api/process-pdf \
  -H "Content-Type: application/json" \
  -d '{
    "pdf_url": "https://example.com/paper.pdf",
    "paper_title": "Test Paper",
    "options": {
      "extract_images": true,
      "extract_tables": true
    }
  }'
```

#### 4.2 Test Workers Integration
```bash
# Test the full pipeline
curl -X POST https://your-worker.your-subdomain.workers.dev/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "pdfUrl": "https://example.com/paper.pdf",
    "filename": "test-paper.pdf",
    "paperTitle": "Test Research Paper"
  }'
```

### Step 5: Monitoring and Optimization

#### 5.1 EC2 Monitoring
```bash
# Monitor system resources
htop
df -h
free -h

# Monitor application logs
sudo journalctl -u rag-api -f
```

#### 5.2 Cloudflare Analytics
- Monitor Workers execution time
- Check Vectorize query performance
- Review D1 database usage

#### 5.3 Performance Optimization
```python
# Add caching to EC2 API
# Implement connection pooling
# Use async processing for large files
# Add rate limiting
```

## Environment Variables

### EC2 API (.env)
```bash
GOOGLE_API_KEY=your-gemini-api-key
REDIS_URL=redis://localhost:6379
MAX_FILE_SIZE=50
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
CACHE_TTL=3600
```

### Cloudflare Workers (wrangler.jsonc)
```json
{
  "vars": {
    "GOOGLE_API_KEY": "your-gemini-api-key",
    "EC2_API_URL": "https://your-ec2-ip:8000",
    "EC2_API_KEY": "your-secret-api-key"
  }
}
```

## Cost Optimization

### EC2 Instance Sizing
- **Development**: t3.medium (2 vCPU, 4GB RAM)
- **Production**: t3.large (2 vCPU, 8GB RAM) or larger
- **High Load**: c5.xlarge (4 vCPU, 8GB RAM)

### Cloudflare Workers
- Monitor execution time to stay within limits
- Use Vectorize efficiently
- Optimize D1 queries

## Troubleshooting

### Common Issues

#### 1. EC2 API Not Responding
```bash
# Check if service is running
sudo systemctl status rag-api

# Check logs
sudo journalctl -u rag-api -n 50

# Test local connection
curl http://localhost:8000/api/health
```

#### 2. Workers Timeout
- Reduce chunk size in EC2 API
- Implement async processing
- Add timeout handling

#### 3. PDF Processing Failures
- Check file size limits
- Verify PDF accessibility
- Review error logs

#### 4. Embedding Generation Issues
- Verify Google API key
- Check rate limits
- Monitor API usage

## Scaling Considerations

### Horizontal Scaling
- Use Application Load Balancer
- Deploy multiple EC2 instances
- Implement auto-scaling groups

### Vertical Scaling
- Increase EC2 instance size
- Add more memory for large PDFs
- Use GPU instances for heavy ML workloads

### Caching Strategy
- Redis for processed results
- Cloudflare Cache for static content
- Local caching in Workers

## Security Best Practices

1. **API Authentication**: Use API keys or JWT tokens
2. **HTTPS Only**: Enable SSL/TLS for all communications
3. **Input Validation**: Validate all PDF URLs and inputs
4. **Rate Limiting**: Implement rate limiting on EC2 API
5. **Monitoring**: Set up alerts for unusual activity
6. **Secrets Management**: Use Cloudflare Secrets for sensitive data

## Backup and Recovery

### Database Backups
```bash
# Backup D1 database
wrangler d1 export database --output=backup.sql

# Restore from backup
wrangler d1 execute database --file=backup.sql
```

### EC2 Data Backup
- Use EBS snapshots
- Backup processed results to S3
- Implement automated backup schedules
