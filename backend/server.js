const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const archiver = require('archiver');
const { PDFDocument } = require('pdf-lib');

const app = express();
const port = process.env.PORT || 10000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

const uploadDir = path.join('/tmp', 'pdf_uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

app.get('/', (req, res) => {
    res.status(200).send('PDFConverts iLovePDF Quality Backend Active!');
});

const cleanUpFiles = (filePaths) => {
    filePaths.forEach(fp => {
        if (fp && fs.existsSync(fp)) {
            try { fs.unlinkSync(fp); } catch (e) { console.error('Cleanup error:', e); }
        }
    });
};

// -------------------------------------------------------------
// 1. MERGE PDF (Maintains Exact Order from Frontend)
// -------------------------------------------------------------
app.post('/api/merge', upload.array('files'), async (req, res) => {
    const uploadedFiles = req.files || [];
    try {
        if (uploadedFiles.length < 2) {
            return res.status(400).json({ error: 'Please upload at least 2 PDF files to merge.' });
        }

        const mergedPdf = await PDFDocument.create();

        for (const file of uploadedFiles) {
            const pdfBytes = fs.readFileSync(file.path);
            const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }

        const finalBytes = await mergedPdf.save();
        cleanUpFiles(uploadedFiles.map(f => f.path));

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="merged_document.pdf"');
        res.send(Buffer.from(finalBytes));
    } catch (err) {
        cleanUpFiles(uploadedFiles.map(f => f.path));
        res.status(500).json({ error: 'Merge failed: ' + err.message });
    }
});

// -------------------------------------------------------------
// 2. SPLIT PDF (Page Ranges Support e.g., 1-3, 5)
// -------------------------------------------------------------
app.post('/api/split', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded.' });
    const filePath = req.file.path;
    const pageRangeStr = req.body.pages || '1';

    try {
        const pdfBytes = fs.readFileSync(filePath);
        const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const totalPages = srcDoc.getPageCount();

        let pagesToExtract = [];
        const parts = pageRangeStr.split(',');

        parts.forEach(part => {
            if (part.includes('-')) {
                const [start, end] = part.split('-').map(n => parseInt(n.trim()));
                if (!isNaN(start) && !isNaN(end)) {
                    for (let i = start; i <= end; i++) {
                        if (i >= 1 && i <= totalPages) pagesToExtract.push(i - 1);
                    }
                }
            } else {
                const p = parseInt(part.trim());
                if (!isNaN(p) && p >= 1 && p <= totalPages) pagesToExtract.push(p - 1);
            }
        });

        if (pagesToExtract.length === 0) pagesToExtract = [0];

        const newDoc = await PDFDocument.create();
        const copiedPages = await newDoc.copyPages(srcDoc, pagesToExtract);
        copiedPages.forEach(p => newDoc.addPage(p));

        const splitBytes = await newDoc.save();
        cleanUpFiles([filePath]);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="split_document.pdf"');
        res.send(Buffer.from(splitBytes));
    } catch (err) {
        cleanUpFiles([filePath]);
        res.status(500).json({ error: 'Split failed: ' + err.message });
    }
});

// -------------------------------------------------------------
// 3. COMPRESS PDF (Ghostscript High Efficiency)
// -------------------------------------------------------------
app.post('/api/compress', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded.' });
    const inputPath = req.file.path;
    const outputPath = path.join(uploadDir, `compressed_${Date.now()}.pdf`);

    const gsCmd = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;

    exec(gsCmd, (error) => {
        if (error || !fs.existsSync(outputPath)) {
            cleanUpFiles([inputPath]);
            return res.status(500).json({ error: 'Ghostscript compression failed.' });
        }

        res.download(outputPath, 'compressed_document.pdf', () => {
            cleanUpFiles([inputPath, outputPath]);
        });
    });
});

// -------------------------------------------------------------
// 4. IMAGE TO PDF
// -------------------------------------------------------------
app.post('/api/image-to-pdf', upload.array('files'), async (req, res) => {
    const uploadedFiles = req.files || [];
    try {
        if (uploadedFiles.length === 0) return res.status(400).json({ error: 'No images uploaded.' });

        const pdfDoc = await PDFDocument.create();

        for (const file of uploadedFiles) {
            const imageBytes = fs.readFileSync(file.path);
            let image;

            const ext = path.extname(file.originalname).toLowerCase();
            if (ext === '.png' || file.mimetype === 'image/png') {
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
        res.setHeader('Content-Disposition', 'attachment; filename="converted_images.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        cleanUpFiles(uploadedFiles.map(f => f.path));
        res.status(500).json({ error: 'Image to PDF failed: ' + err.message });
    }
});

// -------------------------------------------------------------
// 5. PDF TO IMAGE (Poppler Engine)
// -------------------------------------------------------------
app.post('/api/pdf-to-image', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded.' });

    const filePath = req.file.path;
    const outputPrefix = path.join(uploadDir, `page_${Date.now()}`);

    exec(`pdftoppm -png -r 150 "${filePath}" "${outputPrefix}"`, (error) => {
        if (error) {
            cleanUpFiles([filePath]);
            return res.status(500).json({ error: 'PDF to Image rendering failed.' });
        }

        const filesInDir = fs.readdirSync(uploadDir);
        const generatedImages = filesInDir
            .filter(f => f.startsWith(path.basename(outputPrefix)) && f.endsWith('.png'))
            .map(f => path.join(uploadDir, f));

        if (generatedImages.length === 0) {
            cleanUpFiles([filePath]);
            return res.status(500).json({ error: 'No image pages generated.' });
        }

        if (generatedImages.length === 1) {
            res.download(generatedImages[0], 'page_1.png', () => {
                cleanUpFiles([filePath, ...generatedImages]);
            });
        } else {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="pdf_pages.zip"');

            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);

            generatedImages.forEach((imgFile, idx) => {
                archive.file(imgFile, { name: `page_${idx + 1}.png` });
            });

            archive.finalize();

            res.on('finish', () => {
                cleanUpFiles([filePath, ...generatedImages]);
            });
        }
    });
});

// -------------------------------------------------------------
// 6. WORD TO PDF (LibreOffice Engine)
// -------------------------------------------------------------
app.post('/api/word-to-pdf', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No Word (.docx) file uploaded.' });

    const inputPath = req.file.path;

    exec(`soffice --headless --convert-to pdf "${inputPath}" --outdir "${uploadDir}"`, (error) => {
        if (error) {
            cleanUpFiles([inputPath]);
            return res.status(500).json({ error: 'Word to PDF conversion failed.' });
        }

        const expectedPdfPath = path.join(uploadDir, path.basename(inputPath, path.extname(inputPath)) + '.pdf');

        if (fs.existsSync(expectedPdfPath)) {
            res.download(expectedPdfPath, 'converted_word.pdf', () => {
                cleanUpFiles([inputPath, expectedPdfPath]);
            });
        } else {
            cleanUpFiles([inputPath]);
            res.status(500).json({ error: 'Output PDF file not found.' });
        }
    });
});

// -------------------------------------------------------------
// 7. PDF TO WORD (LibreOffice Native PDF Engine - Retains All Images & Layout)
// -------------------------------------------------------------
app.post('/api/pdf-to-word', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded.' });

    const inputPath = req.file.path;

    // Use LibreOffice to retain images, tables, layouts, and vector graphics accurately
    exec(`soffice --headless --infilter="writer_pdf_import" --convert-to docx "${inputPath}" --outdir "${uploadDir}"`, (error) => {
        if (error) {
            cleanUpFiles([inputPath]);
            return res.status(500).json({ error: 'PDF to Word conversion failed.' });
        }

        const expectedDocxPath = path.join(uploadDir, path.basename(inputPath, path.extname(inputPath)) + '.docx');

        if (fs.existsSync(expectedDocxPath)) {
            const originalName = (req.file.originalname || 'document').replace(/\.pdf$/i, '') + '.docx';
            res.download(expectedDocxPath, originalName, () => {
                cleanUpFiles([inputPath, expectedDocxPath]);
            });
        } else {
            cleanUpFiles([inputPath]);
            res.status(500).json({ error: 'Converted DOCX file not found.' });
        }
    });
});

app.listen(port, () => {
    console.log(`PDFConverts High-Precision Engine operational on port ${port}`);
});