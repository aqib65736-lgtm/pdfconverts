const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const archiver = require('archiver');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');

const app = express();
const port = process.env.PORT || 10000;

// Enable CORS for Vercel Frontend
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Temporary Working Directory in Linux Container
const uploadDir = path.join('/tmp', 'pdf_uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

// Health Check Endpoint
app.get('/', (req, res) => {
    res.status(200).send('PDFConverts Backend Server is Running Perfectly!');
});

// Helper Function: Delete Temp Files
const cleanUpFiles = (filePaths) => {
    filePaths.forEach(fp => {
        if (fp && fs.existsSync(fp)) {
            try { fs.unlinkSync(fp); } catch (e) { console.error('Cleanup error:', e); }
        }
    });
};

// -------------------------------------------------------------
// TOOL 1: MERGE PDF
// -------------------------------------------------------------
app.post('/api/merge', upload.array('files'), async (req, res) => {
    const uploadedFiles = req.files || [];
    try {
        if (uploadedFiles.length === 0) return res.status(400).json({ error: 'No files uploaded' });

        const mergedPdf = await PDFDocument.create();
        for (const file of uploadedFiles) {
            const pdfBytes = fs.readFileSync(file.path);
            const pdf = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }

        const finalPdfBytes = await mergedPdf.save();
        cleanUpFiles(uploadedFiles.map(f => f.path));

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="merged.pdf"');
        res.send(Buffer.from(finalPdfBytes));
    } catch (err) {
        cleanUpFiles(uploadedFiles.map(f => f.path));
        res.status(500).json({ error: 'Failed to merge PDFs: ' + err.message });
    }
});

// -------------------------------------------------------------
// TOOL 2: SPLIT PDF
// -------------------------------------------------------------
app.post('/api/split', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = req.file.path;

    try {
        const pdfBytes = fs.readFileSync(filePath);
        const srcDoc = await PDFDocument.load(pdfBytes);

        const newDoc = await PDFDocument.create();
        const copiedPages = await newDoc.copyPages(srcDoc, [0]);
        newDoc.addPage(copiedPages[0]);

        const splitPdfBytes = await newDoc.save();
        cleanUpFiles([filePath]);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="split_page_1.pdf"');
        res.send(Buffer.from(splitPdfBytes));
    } catch (err) {
        cleanUpFiles([filePath]);
        res.status(500).json({ error: 'Failed to split PDF: ' + err.message });
    }
});

// -------------------------------------------------------------
// TOOL 3: COMPRESS PDF
// -------------------------------------------------------------
app.post('/api/compress', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = req.file.path;

    try {
        const pdfBytes = fs.readFileSync(filePath);
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

        const compressedPdfBytes = await pdfDoc.save({ useObjectStreams: true });
        cleanUpFiles([filePath]);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="compressed.pdf"');
        res.send(Buffer.from(compressedPdfBytes));
    } catch (err) {
        cleanUpFiles([filePath]);
        res.status(500).json({ error: 'Failed to compress PDF: ' + err.message });
    }
});

// -------------------------------------------------------------
// TOOL 4: IMAGE TO PDF
// -------------------------------------------------------------
app.post('/api/image-to-pdf', upload.array('files'), async (req, res) => {
    const uploadedFiles = req.files || [];
    try {
        if (uploadedFiles.length === 0) return res.status(400).json({ error: 'No images uploaded' });

        const pdfDoc = await PDFDocument.create();

        for (const file of uploadedFiles) {
            const imageBytes = fs.readFileSync(file.path);
            let image;

            if (file.mimetype === 'image/png' || file.originalname.toLowerCase().endsWith('.png')) {
                image = await pdfDoc.embedPng(imageBytes);
            } else {
                image = await pdfDoc.embedJpg(imageBytes);
            }

            const page = pdfDoc.addPage([image.width, image.height]);
            page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        }

        const pdfBytes = await pdfDoc.save();
        cleanUpFiles(uploadedFiles.map(f => f.path));

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="images_converted.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        cleanUpFiles(uploadedFiles.map(f => f.path));
        res.status(500).json({ error: 'Failed to convert images: ' + err.message });
    }
});

// -------------------------------------------------------------
// TOOL 5: PDF TO IMAGE (Using Poppler pdftoppm)
// -------------------------------------------------------------
app.post('/api/pdf-to-image', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = req.file.path;
    const outputPrefix = path.join(uploadDir, `img_${Date.now()}`);

    // pdftoppm extracts high resolution PNG pages
    exec(`pdftoppm -png -r 150 "${filePath}" "${outputPrefix}"`, (error) => {
        if (error) {
            cleanUpFiles([filePath]);
            return res.status(500).json({ error: 'PDF to Image conversion failed' });
        }

        // Find created PNG files
        const filesInDir = fs.readdirSync(uploadDir);
        const generatedImages = filesInDir
            .filter(f => f.startsWith(path.basename(outputPrefix)) && f.endsWith('.png'))
            .map(f => path.join(uploadDir, f));

        if (generatedImages.length === 0) {
            cleanUpFiles([filePath]);
            return res.status(500).json({ error: 'No images generated' });
        }

        // Return single PNG if 1 page, else stream a ZIP
        if (generatedImages.length === 1) {
            res.download(generatedImages[0], 'converted_page.png', () => {
                cleanUpFiles([filePath, ...generatedImages]);
            });
        } else {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="pdf_images.zip"');

            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);

            generatedImages.forEach((imgFile, index) => {
                archive.file(imgFile, { name: `page_${index + 1}.png` });
            });

            archive.finalize();

            res.on('finish', () => {
                cleanUpFiles([filePath, ...generatedImages]);
            });
        }
    });
});

// -------------------------------------------------------------
// TOOL 6: WORD TO PDF (Using LibreOffice CLI Engine)
// -------------------------------------------------------------
app.post('/api/word-to-pdf', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No DOCX file uploaded' });

    const inputPath = req.file.path;

    // LibreOffice command to convert docx to pdf
    exec(`soffice --headless --convert-to pdf "${inputPath}" --outdir "${uploadDir}"`, (error) => {
        if (error) {
            cleanUpFiles([inputPath]);
            return res.status(500).json({ error: 'Word to PDF conversion failed: ' + error.message });
        }

        const expectedPdfPath = inputPath + '.pdf';

        if (fs.existsSync(expectedPdfPath)) {
            res.download(expectedPdfPath, 'converted_word.pdf', () => {
                cleanUpFiles([inputPath, expectedPdfPath]);
            });
        } else {
            cleanUpFiles([inputPath]);
            res.status(500).json({ error: 'Converted PDF file not found' });
        }
    });
});

// -------------------------------------------------------------
// TOOL 7: PDF TO WORD / TEXT
// -------------------------------------------------------------
app.post('/api/pdf-to-word', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = req.file.path;

    try {
        const pdfBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(pdfBuffer);
        cleanUpFiles([filePath]);

        const extractedText = pdfData.text || "No readable text found in this PDF.";
        const outputFilename = (req.file.originalname || 'document').replace(/\.pdf$/i, '') + '.txt';

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
        res.send(extractedText);
    } catch (err) {
        cleanUpFiles([filePath]);
        res.status(500).json({ error: 'Failed to extract text: ' + err.message });
    }
});

app.listen(port, () => {
    console.log(`PDFConverts Backend operational on port ${port}`);
});