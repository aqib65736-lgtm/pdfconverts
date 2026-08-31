FROM node:18-slim

# System level binaries for LibreOffice, Ghostscript, Poppler & Python
RUN apt-get update && apt-get install -y \
    ghostscript \
    poppler-utils \
    libreoffice \
    tesseract-ocr \
    python3 \
    python3-pip \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*
# Install python-based PDF2DOCX engine with --break-system-packages flag
RUN pip3 install --no-cache-dir --break-system-packages pdf2docx PyMuPDF

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]