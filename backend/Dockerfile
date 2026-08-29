# Base Node.js Linux image
FROM node:18-slim

# Install server-side PDF libraries and system utilities
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

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application source code
COPY . .

# Expose server port
EXPOSE 10000

# Start Express server
CMD ["npm", "start"]