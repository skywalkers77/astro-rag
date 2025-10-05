# EC2 API Deployment Guide

## Prerequisites
- AWS EC2 instance (Ubuntu 22.04 LTS recommended)
- t3.large or larger instance (2+ vCPU, 8+ GB RAM)
- Security group allowing inbound traffic on port 8000
- SSH access to your EC2 instance

## Method 1: Automated Deployment (Recommended)

### Step 1: Launch EC2 Instance
```bash
# Launch EC2 instance with:
# - Ubuntu 22.04 LTS
# - t3.large (2 vCPU, 8GB RAM) or larger
# - Security group: Allow inbound on port 8000 from your IP
# - Key pair for SSH access
```

### Step 2: Connect to EC2
```bash
# SSH into your instance
ssh -i your-key.pem ubuntu@your-ec2-public-ip
```

### Step 3: Upload Your Code
```bash
# Option A: Using SCP (from your local machine)
scp -i your-key.pem -r /path/to/rag-ai-tutorial/ec2-api ubuntu@your-ec2-ip:/home/ubuntu/

# Option B: Using Git (on EC2)
git clone https://github.com/your-username/rag-ai-tutorial.git
cd rag-ai-tutorial/ec2-api
```

### Step 4: Run Deployment Script
```bash
# Make script executable and run
chmod +x deploy.sh
./deploy.sh
```

### Step 5: Configure Environment
```bash
# Edit environment file
nano /home/ubuntu/rag-api/.env

# Add your Google API key:
GOOGLE_API_KEY=your-actual-gemini-api-key-here
```

### Step 6: Start the Service
```bash
# Start the API service
sudo systemctl start rag-api

# Check status
sudo systemctl status rag-api

# View logs
sudo journalctl -u rag-api -f
```

### Step 7: Test the API
```bash
# Test health endpoint
curl http://localhost:8000/api/health

# Test from outside (replace with your EC2 public IP)
curl http://your-ec2-public-ip:8000/api/health
```

## Method 2: Manual Deployment

### Step 1: Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### Step 2: Install Python 3.11
```bash
sudo apt install -y python3.11 python3.11-pip python3.11-venv python3.11-dev
```

### Step 3: Install System Dependencies
```bash
sudo apt install -y \
    libpoppler-cpp-dev \
    libpoppler-dev \
    poppler-utils \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libfontconfig1 \
    libfreetype6 \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libwebp-dev \
    libopenjp2-7-dev \
    libharfbuzz-dev \
    libfribidi-dev \
    libxcb1-dev \
    curl \
    wget \
    git
```

### Step 4: Create Application Directory
```bash
mkdir -p /home/ubuntu/rag-api
cd /home/ubuntu/rag-api
```

### Step 5: Copy Application Files
```bash
# Copy your ec2-api files to /home/ubuntu/rag-api/
cp -r /path/to/your/ec2-api/* /home/ubuntu/rag-api/
```

### Step 6: Setup Python Environment
```bash
# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install dependencies
pip install -r requirements.txt
```

### Step 7: Create Environment File
```bash
cat > .env << EOF
GOOGLE_API_KEY=your-gemini-api-key-here
MAX_FILE_SIZE=50
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
CACHE_TTL=3600
HOST=0.0.0.0
PORT=8000
WORKERS=1
EOF
```

### Step 8: Create Systemd Service
```bash
sudo nano /etc/systemd/system/rag-api.service
```

Add this content:
```ini
[Unit]
Description=RAG Processing API
After=network.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/rag-api
Environment=PATH=/home/ubuntu/rag-api/venv/bin
ExecStart=/home/ubuntu/rag-api/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Step 9: Enable and Start Service
```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service
sudo systemctl enable rag-api

# Start service
sudo systemctl start rag-api

# Check status
sudo systemctl status rag-api
```

## Testing Your Deployment

### 1. Health Check
```bash
curl http://localhost:8000/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "gemini_status": "connected",
  "uptime": 0,
  "version": "1.0.0"
}
```

### 2. Test PDF Processing
```bash
curl -X POST http://localhost:8000/api/process-pdf \
  -H "Content-Type: application/json" \
  -d '{
    "pdf_url": "https://arxiv.org/pdf/2301.00001.pdf",
    "paper_title": "Test Paper",
    "options": {
      "extract_images": true,
      "extract_tables": true,
      "chunk_size": 1000,
      "chunk_overlap": 200
    }
  }'
```

### 3. Test from External IP
```bash
# Replace with your EC2 public IP
curl http://your-ec2-public-ip:8000/api/health
```

## Troubleshooting

### Check Service Status
```bash
sudo systemctl status rag-api
```

### View Logs
```bash
# View recent logs
sudo journalctl -u rag-api -n 50

# Follow logs in real-time
sudo journalctl -u rag-api -f
```

### Check Port
```bash
# Check if port 8000 is listening
sudo netstat -tlnp | grep 8000
```

### Test Locally
```bash
# Run directly for debugging
cd /home/ubuntu/rag-api
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Common Issues

#### 1. Permission Denied
```bash
# Fix file permissions
sudo chown -R ubuntu:ubuntu /home/ubuntu/rag-api
chmod +x /home/ubuntu/rag-api/deploy.sh
```

#### 2. Python Dependencies Issues
```bash
# Reinstall dependencies
cd /home/ubuntu/rag-api
source venv/bin/activate
pip install --force-reinstall -r requirements.txt
```

#### 3. Port Already in Use
```bash
# Kill process using port 8000
sudo lsof -ti:8000 | xargs sudo kill -9
```

#### 4. Google API Key Issues
```bash
# Check environment file
cat /home/ubuntu/rag-api/.env

# Test API key
curl -H "Authorization: Bearer your-api-key" https://generativelanguage.googleapis.com/v1/models
```

## Security Configuration

### 1. Update Security Group
- Allow inbound on port 8000 from your IP only
- Or use Application Load Balancer for better security

### 2. Add API Authentication (Optional)
```python
# Add to your main.py
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

### 3. Enable HTTPS (Optional)
```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com
```

## Monitoring

### 1. System Resources
```bash
# Monitor CPU and memory
htop

# Monitor disk usage
df -h

# Monitor network
iftop
```

### 2. Application Metrics
```bash
# Check service status
sudo systemctl status rag-api

# Monitor logs
sudo journalctl -u rag-api -f
```

### 3. API Performance
```bash
# Test response time
time curl http://localhost:8000/api/health
```

## Next Steps

1. **Update Cloudflare Workers** with your EC2 API URL
2. **Test the full pipeline** with a sample PDF
3. **Monitor performance** and scale as needed
4. **Set up monitoring** and alerting
5. **Configure backups** for your data

Your EC2 API should now be running and ready to process PDFs with Gemini 1.5 Flash!
