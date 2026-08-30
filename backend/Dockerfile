FROM node:18-slim

# Install LibreOffice, Ghostscript, Poppler & Utilities for iLovePDF quality
RUN apt-get update && apt-get install -y \
    libreoffice \
    ghostscript \
    poppler-utils \
    graphicsmagick \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]