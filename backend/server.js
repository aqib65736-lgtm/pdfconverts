const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Serve static HTML file
app.use(express.static(__dirname));

// Ensure upload directory exists in /tmp
const uploadDir = path.join('/tmp', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

// Home route to serve HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. MERGE PDF
app.post('/api/merge', upload.array('files'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const mergedPdf = await PDFDocument.create();
        for (const file of req.files) {
            const pdfBytes = fs.readFileSync(file.path);
            const pdf = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
            
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }

        const finalPdfBytes = await mergedPdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="merged.pdf"');
        res.send(Buffer.from(finalPdfBytes));
    } catch (err) {
        console.error('Merge Error:', err);
        res.status(500).json({ error: 'Failed to merge PDFs: ' + err.message });
    }
});

// 2. SPLIT PDF
app.post('/api/split', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const pdfBytes = fs.readFileSync(req.file.path);
        const srcDoc = await PDFDocument.load(pdfBytes);

        const newDoc = await PDFDocument.create();
        const copiedPages = await newDoc.copyPages(srcDoc, [0]);
        newDoc.addPage(copiedPages[0]);

        const splitPdfBytes = await newDoc.save();
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="split_page_1.pdf"');
        res.send(Buffer.from(splitPdfBytes));
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('Split Error:', err);
        res.status(500).json({ error: 'Failed to split PDF: ' + err.message });
    }
});

// 3. COMPRESS PDF
app.post('/api/compress', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const pdfBytes = fs.readFileSync(req.file.path);
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

        const compressedPdfBytes = await pdfDoc.save({ useObjectStreams: true });
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="compressed.pdf"');
        res.send(Buffer.from(compressedPdfBytes));
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('Compress Error:', err);
        res.status(500).json({ error: 'Failed to compress PDF: ' + err.message });
    }
});

// 4. IMAGE TO PDF
app.post('/api/image-to-pdf', upload.array('files'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No images uploaded' });
        }

        const pdfDoc = await PDFDocument.create();

        for (const file of req.files) {
            const imageBytes = fs.readFileSync(file.path);
            let image;

            if (file.mimetype === 'image/png' || file.originalname.toLowerCase().endsWith('.png')) {
                image = await pdfDoc.embedPng(imageBytes);
            } else {
                image = await pdfDoc.embedJpg(imageBytes);
            }

            const page = pdfDoc.addPage([image.width, image.height]);
            page.drawImage(image, {
                x: 0,
                y: 0,
                width: image.width,
                height: image.height,
            });

            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }

        const pdfBytes = await pdfDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="converted_images.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error('Image to PDF Error:', err);
        res.status(500).json({ error: 'Failed to convert images to PDF: ' + err.message });
    }
});

// 5. PDF TO WORD / TEXT
app.post('/api/pdf-to-word', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const pdfBuffer = fs.readFileSync(req.file.path);
        const pdfData = await pdfParse(pdfBuffer);
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        const extractedText = pdfData.text || "No readable text found in this PDF.";
        const outputFilename = req.file.originalname.replace(/\.pdf$/i, '') + '.txt';

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
        res.send(extractedText);
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('PDF to Word Error:', err);
        res.status(500).json({ error: 'Failed to convert PDF to Word/Text: ' + err.message });
    }
});

app.listen(port, () => {
    console.log(`PDFConverts Server running on port ${port}`);
});