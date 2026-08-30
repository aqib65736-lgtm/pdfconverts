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
    && rm -rf /var/lib/apt/lists/*

# Install python-based PDF2DOCX engine which retains layout, tables and embedded images
RUN pip3 install --no-cache-dir pdf2docx PyMuPDF || pip3 install pdf2docx

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]