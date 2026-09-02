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

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

const uploadDir = path.join('/tmp', 'pdf_uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

const cleanUpFiles = (filePaths) => {
    filePaths.forEach(fp => {
        if (fp && fs.existsSync(fp)) {
            try { fs.unlinkSync(fp); } catch (e) { console.error('Cleanup error:', e); }
        }
    });
};

// -------------------------------------------------------------
// 1. MERGE PDF (Strict Sequential Order Maintenance)
// -------------------------------------------------------------
app.post('/api/merge', upload.array('files'), async (req, res) => {
    const uploadedFiles = req.files || [];
    try {
        if (uploadedFiles.length < 2) return res.status(400).json({ error: 'Upload at least 2 files' });

        const mergedPdf = await PDFDocument.create();

        // Preserve exact sequence of user uploads
        for (let i = 0; i < uploadedFiles.length; i++) {
            const filePath = uploadedFiles[i].path;
            const pdfBytes = fs.readFileSync(filePath);
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
// 2. SPLIT PDF (Page Serial / Range Support)
// -------------------------------------------------------------
app.post('/api/split', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = req.file.path;
    const pageRangeStr = req.body.pageRange || '1';

    try {
        const pdfBytes = fs.readFileSync(filePath);
        const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const totalPages = srcDoc.getPageCount();

        const selectedIndices = new Set();
        const parts = pageRangeStr.split(',');

        parts.forEach(part => {
            const range = part.trim().split('-');
            if (range.length === 2) {
                let start = parseInt(range[0]) - 1;
                let end = parseInt(range[1]) - 1;
                for (let i = start; i <= end; i++) {
                    if (i >= 0 && i < totalPages) selectedIndices.add(i);
                }
            } else {
                let single = parseInt(part.trim()) - 1;
                if (!isNaN(single) && single >= 0 && single < totalPages) selectedIndices.add(single);
            }
        });

        const pagesToExtract = Array.from(selectedIndices).sort((a, b) => a - b);
        const newDoc = await PDFDocument.create();

        if (pagesToExtract.length > 0) {
            const copiedPages = await newDoc.copyPages(srcDoc, pagesToExtract);
            copiedPages.forEach(p => newDoc.addPage(p));
        } else {
            const copiedPages = await newDoc.copyPages(srcDoc, [0]);
            newDoc.addPage(copiedPages[0]);
        }

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
// 3. COMPRESS PDF (Using PyMuPDF - Lightweight & Accurate)
// -------------------------------------------------------------
app.post('/api/compress', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const inputPath = req.file.path;
    const outputPath = path.join(uploadDir, `compressed_${Date.now()}.pdf`);

    // PyMuPDF (fitz) se compress karein:
    // garbage=4  -> Unused objects hata kar file size kam karein
    // deflate=True -> Streams ko compress karein (ZIP)
    // clean=True -> Metadata clean karein
    const pythonCmd = `python3 -c "import fitz; doc=fitz.open('${inputPath}'); doc.save('${outputPath}', garbage=4, deflate=True, clean=True); doc.close()"`;

    // Render free plan ke liye 60 seconds ka timeout (taake zyada wait na karna pade)
    exec(pythonCmd, { timeout: 60000 }, (error, stdout, stderr) => {
        // Agar error aaye toh input file delete karein
        if (error) {
            console.error('Compression Error (PyMuPDF):', error.message, stderr);
            cleanUpFiles([inputPath]);
            return res.status(500).json({ error: 'Compression failed. Please try again with a smaller file.' });
        }

        // Agar output file generate nahi hui toh error
        if (!fs.existsSync(outputPath)) {
            cleanUpFiles([inputPath]);
            return res.status(500).json({ error: 'Compression failed. Output file missing.' });
        }

        // Success! File download karayein
        res.download(outputPath, 'compressed.pdf', () => {
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
        if (uploadedFiles.length === 0) return res.status(400).json({ error: 'No files uploaded' });

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
        res.setHeader('Content-Disposition', 'attachment; filename="images.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        cleanUpFiles(uploadedFiles.map(f => f.path));
        res.status(500).json({ error: 'Image conversion failed: ' + err.message });
    }
});

// -------------------------------------------------------------
// 5. PDF TO IMAGE
// -------------------------------------------------------------
app.post('/api/pdf-to-image', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = req.file.path;
    const outputPrefix = path.join(uploadDir, `page_${Date.now()}`);

    exec(`pdftoppm -png -r 150 "${filePath}" "${outputPrefix}"`, (error) => {
        if (error) {
            cleanUpFiles([filePath]);
            return res.status(500).json({ error: 'Extraction failed' });
        }

        const filesInDir = fs.readdirSync(uploadDir);
        const generatedImages = filesInDir
            .filter(f => f.startsWith(path.basename(outputPrefix)) && f.endsWith('.png'))
            .map(f => path.join(uploadDir, f));

        if (generatedImages.length === 1) {
            res.download(generatedImages[0], 'page_1.png', () => {
                cleanUpFiles([filePath, ...generatedImages]);
            });
        } else {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="images.zip"');

            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);

            generatedImages.forEach((imgFile, idx) => {
                archive.file(imgFile, { name: `page_${idx + 1}.png` });
            });

            archive.finalize();
            res.on('finish', () => cleanUpFiles([filePath, ...generatedImages]));
        }
    });
});

// -------------------------------------------------------------
// 6. WORD TO PDF
// -------------------------------------------------------------
app.post('/api/word-to-pdf', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No DOCX file uploaded' });

    const inputPath = req.file.path;

    exec(`soffice --headless --convert-to pdf "${inputPath}" --outdir "${uploadDir}"`, (error) => {
        if (error) {
            cleanUpFiles([inputPath]);
            return res.status(500).json({ error: 'Conversion failed' });
        }

        const expectedPdfPath = path.join(uploadDir, path.basename(inputPath, path.extname(inputPath)) + '.pdf');

        if (fs.existsSync(expectedPdfPath)) {
            res.download(expectedPdfPath, 'converted.pdf', () => {
                cleanUpFiles([inputPath, expectedPdfPath]);
            });
        } else {
            cleanUpFiles([inputPath]);
            res.status(500).json({ error: 'PDF file not found' });
        }
    });
});

// -------------------------------------------------------------
// 7. PDF TO WORD (pdf2docx preserving text, layout & embedded images)
// -------------------------------------------------------------
app.post('/api/pdf-to-word', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded.' });

    const inputPath = req.file.path;
    const outputPath = path.join(uploadDir, `converted_${Date.now()}.docx`);

    // Call Python pdf2docx command line tool
    const cmd = `python3 -c "from pdf2docx import Converter; cv = Converter(r'${inputPath}'); cv.convert(r'${outputPath}'); cv.close()"`;

    exec(cmd, (error) => {
        if (error || !fs.existsSync(outputPath)) {
            cleanUpFiles([inputPath]);
            return res.status(500).json({ error: 'PDF to Word conversion failed: ' + (error ? error.message : 'File write failed') });
        }

        const downloadFileName = (req.file.originalname || 'document').replace(/\.pdf$/i, '') + '.docx';

        res.download(outputPath, downloadFileName, () => {
            cleanUpFiles([inputPath, outputPath]);
        });
    });
});

app.listen(port, () => {
    console.log(`Enhanced PDFConverts Engine operational on port ${port}`);
});