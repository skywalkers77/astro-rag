#!/bin/bash

# EC2 API Deployment Script
# Run this script on your EC2 instance to deploy the RAG API

set -e  # Exit on any error

echo "🚀 Starting EC2 API Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root. Please run as a regular user."
   exit 1
fi

# Update system packages
print_status "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Python 3.11 and pip
print_status "Installing Python 3.11..."
sudo apt install -y python3.11 python3.11-pip python3.11-venv python3.11-dev

# Install system dependencies for PDF processing
print_status "Installing system dependencies for PDF processing..."
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

# Create application directory
APP_DIR="/home/$USER/rag-api"
print_status "Creating application directory: $APP_DIR"
mkdir -p $APP_DIR
cd $APP_DIR

# Copy application files (assuming they're in the current directory)
print_status "Copying application files..."
cp -r /home/$USER/rag-ai-tutorial/ec2-api/* $APP_DIR/

# Create virtual environment
print_status "Creating Python virtual environment..."
python3.11 -m venv venv
source venv/bin/activate

# Upgrade pip
print_status "Upgrading pip..."
pip install --upgrade pip

# Install Python dependencies
print_status "Installing Python dependencies..."
pip install -r requirements.txt

# Create environment file
print_status "Creating environment configuration..."
cat > .env << EOF
# Google AI Configuration
GOOGLE_API_KEY=your-gemini-api-key-here

# Application Configuration
MAX_FILE_SIZE=50
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
CACHE_TTL=3600

# Server Configuration
HOST=0.0.0.0
PORT=8000
WORKERS=1

# Optional: Redis Configuration (if you want to add caching later)
# REDIS_URL=redis://localhost:6379
EOF

print_warning "Please edit .env file and add your actual Google API key:"
print_warning "nano $APP_DIR/.env"

# Create systemd service file
print_status "Creating systemd service..."
sudo tee /etc/systemd/system/rag-api.service > /dev/null << EOF
[Unit]
Description=RAG Processing API
After=network.target

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$APP_DIR
Environment=PATH=$APP_DIR/venv/bin
ExecStart=$APP_DIR/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF

# Create nginx configuration (optional, for production)
print_status "Creating nginx configuration..."
sudo tee /etc/nginx/sites-available/rag-api > /dev/null << EOF
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain or IP

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Increase timeout for large file processing
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOF

# Enable nginx site (optional)
print_status "Enabling nginx site..."
sudo ln -sf /etc/nginx/sites-available/rag-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Set proper permissions
print_status "Setting file permissions..."
chmod +x $APP_DIR/deploy.sh
chown -R $USER:$USER $APP_DIR

# Reload systemd and enable service
print_status "Enabling and starting RAG API service..."
sudo systemctl daemon-reload
sudo systemctl enable rag-api

# Create log directory
sudo mkdir -p /var/log/rag-api
sudo chown $USER:$USER /var/log/rag-api

print_status "Deployment completed successfully!"
echo ""
print_warning "Next steps:"
echo "1. Edit the environment file: nano $APP_DIR/.env"
echo "2. Add your Google API key to the .env file"
echo "3. Start the service: sudo systemctl start rag-api"
echo "4. Check service status: sudo systemctl status rag-api"
echo "5. View logs: sudo journalctl -u rag-api -f"
echo "6. Test the API: curl http://localhost:8000/api/health"
echo ""
print_status "Your API will be available at: http://your-ec2-ip:8000"
