const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: '/tmp/uploads/' });

// Health Check Endpoint
app.get('/', (req, res) => {
    res.send('PDFConverts Processing Server is Running!');
});

// 1. Merge PDF (Server-Side)
app.post('/api/merge', upload.array('files'), async (req, res) => {
    try {
        const mergedPdf = await PDFDocument.create();
        for (const file of req.files) {
            const pdfBytes = fs.readFileSync(file.path);
            const pdf = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
            fs.unlinkSync(file.path);
        }
        const finalPdfBytes = await mergedPdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(finalPdfBytes));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Compress PDF (Using Ghostscript on Server)
app.post('/api/compress', upload.single('file'), (req, res) => {
    const inputPath = req.file.path;
    const outputPath = path.join('/tmp', `compressed_${Date.now()}.pdf`);

    // High performance Ghostscript compression
    const cmd = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${outputPath} ${inputPath}`;

    exec(cmd, (err) => {
        if (err) {
            fs.unlinkSync(inputPath);
            return res.status(500).json({ error: 'Compression failed' });
        }
        res.download(outputPath, () => {
            fs.unlinkSync(inputPath);
            fs.unlinkSync(outputPath);
        });
    });
});

// 3. Word to PDF (Using LibreOffice on Server)
app.post('/api/word-to-pdf', upload.single('file'), (req, res) => {
    const inputPath = req.file.path;
    const outputDir = '/tmp';

    const cmd = `soffice --headless --convert-to pdf ${inputPath} --outdir ${outputDir}`;

    exec(cmd, (err) => {
        if (err) {
            fs.unlinkSync(inputPath);
            return res.status(500).json({ error: 'Conversion failed' });
        }
        const outputPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
        res.download(outputPath, () => {
            fs.unlinkSync(inputPath);
            fs.unlinkSync(outputPath);
        });
    });
});

// 4. PDF to Image (Using Poppler pdftoppm on Server)
app.post('/api/pdf-to-image', upload.single('file'), (req, res) => {
    const inputPath = req.file.path;
    const outputPrefix = path.join('/tmp', `page_${Date.now()}`);

    const cmd = `pdftoppm -png -r 150 ${inputPath} ${outputPrefix}`;

    exec(cmd, (err) => {
        fs.unlinkSync(inputPath);
        if (err) {
            return res.status(500).json({ error: 'Failed to process images' });
        }
        res.json({ message: 'Images generated successfully' });
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});