FROM node:18-slim

# Install system dependencies & document processing engines
RUN apt-get update && apt-get install -y \
    ghostscript \
    poppler-utils \
    libreoffice \
    tesseract-ocr \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install python-based robust pdf2docx library for proper Word conversion
RUN pip3 install pdf2docx --break-system-packages || pip3 install pdf2docx

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]