# Base Node.js Linux image
FROM node:18-slim

# Install system utilities required for all 7 PDF tools
RUN apt-get update && apt-get install -y \
    ghostscript \
    poppler-utils \
    libreoffice \
    tesseract-ocr \
    ffmpeg \
    graphicsmagick \
    && rm -rf /var/lib/apt/lists/*

# Set working directory inside container
WORKDIR /usr/src/app

# Copy package files & install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Expose Render default port
EXPOSE 10000

# Start Express server directly
CMD ["node", "server.js"]