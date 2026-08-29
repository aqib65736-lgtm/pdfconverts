# Base Node.js image
FROM node:18-slim

# Install system utilities for PDF processing
RUN apt-get update && apt-get install -y \
    ghostscript \
    poppler-utils \
    libreoffice \
    tesseract-ocr \
    ffmpeg \
    graphicsmagick \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Expose Render default port
EXPOSE 10000

# Start server directly with Node
CMD ["node", "server.js"]