FROM node:18-slim

RUN apt-get update && apt-get install -y \
    ghostscript \
    poppler-utils \
    libreoffice \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages pdf2docx PyMuPDF

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 10000
CMD ["node", "server.js"]