const fs = require('fs');
const path = require('path');
// pdf-parse v2 dropped the old callable-function API for a class
// (`new PDFParse({ data }).getText()` -> `{ text, pages, total }`); see
// tenderController.js's getTenderDocText for the same pattern.
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { ollamaChat, parseJsonResponse, isOllamaAvailable } = require('../utils/ollamaClient');

// Tenders > Offline Tender — clone of the AUTOMATION SITE reference's
// "Document Tender" page (Admin/User > document-tender), which lets a user
// hand-upload a tender's documents instead of waiting for the scraper to
// find it, and creates a real row in gem_tenders / open_tender_details from
// the extracted text.
//
// Reference PDFs, .docx, .xlsx/.xls, and .txt/.csv all extract text
// directly. A scanned/image-only PDF (real text layer comes back empty or
// near-empty from pdf-parse) falls back to OCR: each page is rasterized
// with pdf-to-img (pure pdfjs-dist, no native canvas build needed) and read
// with tesseract.js — in-process, no external CLI/Python pipeline required.
// Processing runs synchronously in the request since even OCR of a handful
// of pages is fast enough not to need a background-job/polling model.

const MAX_CHARS = 200000;
const OCR_MIN_TEXT_LENGTH = 40; // below this, pdf-parse's result is treated as "no real text layer"
const OCR_MAX_PAGES = 15; // bound worst-case processing time on a long scanned document

// pdf-parse pins its own pdfjs-dist@5.4.296; pdf-to-img (used to rasterize
// scanned PDFs for OCR) needs a newer pdfjs-dist and installs its own
// nested copy. Loading both pdfjs-dist copies into the same process throws
// an API/Worker version mismatch the moment pdf-to-img actually renders a
// page — so rendering runs in a short-lived child process instead (see
// scripts/renderPdfToImages.js), which never imports pdf-parse at all.
const { execFile } = require('child_process');
const os = require('os');

function renderPdfPages(pdfPath, outDir, maxPages = OCR_MAX_PAGES, startPage = 1) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(__dirname, '..', 'scripts', 'renderPdfToImages.js'), pdfPath, outDir, String(maxPages), String(startPage)],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr?.trim() || err.message));
        try { resolve(JSON.parse(stdout.trim()).pages); } catch { reject(new Error('Failed to render PDF pages.')); }
      },
    );
  });
}

// Renders a specific 1-based page range of a PDF to temp PNGs and returns
// them as base64 strings (no data: prefix — ollamaChat's `images` param
// wants raw base64), for Doc Prep's vision-based annexure extraction. The
// caller is responsible for nothing — temp files are cleaned up here.
async function renderPdfPageRangeBase64(pdfPath, startPage, endPage) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docprep-vision-'));
  try {
    const paths = await renderPdfPages(pdfPath, outDir, Math.max(1, endPage - startPage + 1), startPage);
    return paths.map((p) => fs.readFileSync(p).toString('base64'));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

async function ocrPdf(filePath) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tender-ocr-'));
  try {
    const pages = await renderPdfPages(filePath, outDir);
    const Tesseract = require('tesseract.js');
    const worker = await Tesseract.createWorker('eng');
    try {
      let combined = '';
      for (const imgPath of pages) {
        const { data } = await worker.recognize(imgPath);
        combined += `\n${data.text || ''}`;
      }
      return combined;
    } finally {
      await worker.terminate();
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function extractExcelText(filePath) {
  const workbook = new ExcelJS.Workbook();
  return workbook.xlsx.readFile(filePath).then(() => {
    let out = '';
    workbook.eachSheet((sheet) => {
      out += `\n--- Sheet: ${sheet.name} ---\n`;
      sheet.eachRow((row) => {
        const cells = row.values.slice(1).map((v) => (v && typeof v === 'object' && v.text ? v.text : v));
        out += cells.filter((c) => c !== undefined && c !== null).join(' | ') + '\n';
      });
    });
    return out;
  });
}

async function extractText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    const data = await parser.getText();
    await parser.destroy();
    const text = data.text || '';
    // Checking total length alone is a real trap: a scanned PDF commonly
    // returns a non-trivial character COUNT from a repeated e-sign/DSC
    // stamp printed on every page, which can clear a small absolute
    // threshold (even 1-2 chars/page adds up over 50+ pages) while having
    // no real content. Chars-per-page is the actual signal.
    const pageCount = data.total || 1;
    const charsPerPage = text.trim().length / pageCount;
    if (text.trim().length >= OCR_MIN_TEXT_LENGTH && charsPerPage >= 150) return text;
    // No usable text layer — likely a scanned/image-based PDF. OCR it.
    const ocrText = await ocrPdf(filePath);
    if (!ocrText.trim()) throw new Error('Could not read any text from this PDF, even with OCR — try a clearer scan.');
    return ocrText;
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  }
  if (ext === '.doc') {
    throw new Error('Legacy .doc files are not supported — please save as .docx or PDF and re-upload.');
  }
  if (ext === '.xls') {
    throw new Error('Legacy .xls files are not supported — please save as .xlsx or PDF and re-upload.');
  }
  if (ext === '.xlsx') {
    return extractExcelText(filePath);
  }
  return fs.readFileSync(filePath, 'utf8');
}

// Per-page text, for callers that need to locate content by the document's
// OWN printed page numbers (Doc Prep's index-driven annexure discovery —
// see workspaceController.js#parseAnnexureIndexEntries). Returns null for
// anything that isn't a real text-layer PDF (scanned PDFs, .docx, etc. have
// no reliable per-page boundary here) so the caller can fall back cleanly.
async function extractPdfPagesRaw(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.pdf') return null;
  try {
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    const data = await parser.getText();
    await parser.destroy();
    const pageCount = data.total || 1;
    const charsPerPage = (data.text || '').trim().length / pageCount;
    if (charsPerPage < 150) return null; // scanned/no real text layer — index-driven discovery needs real per-page text
    return data.pages.map((p) => ({ num: p.num, text: p.text || '' }));
  } catch (e) { return null; }
}

// Reused by workspaceController.js's Doc Prep (bid-document text
// extraction for annexure discovery) — same PDF/OCR/docx/xlsx pipeline,
// no need for a second implementation.
exports.helpers = { extractText, extractPdfPagesRaw, renderPdfPageRangeBase64 };

const EXTRACTION_SYSTEM_PROMPT = `You are extracting structured tender information from raw tender document text.
Return ONLY a JSON object with these exact keys (use null for anything not found):
{
  "tender_ref": string|null,       // tender reference/bid number as printed in the document
  "title": string|null,            // short tender title / item description
  "organisation_name": string|null,
  "state": string|null,
  "closing_date": string|null,     // as printed, do not reformat
  "opening_date": string|null,
  "emd_amount": string|null,
  "tender_value": string|null,
  "item_category": string|null,
  "eligibility_summary": string|null,
  "source_guess": "gem"|"open",    // "gem" if this looks like a GeM (Government e-Marketplace) bid, else "open"
  "division_guess": "endo"|"diagno"|"both"|null
}`;

// @route POST /api/tenders/document-tender   (multipart, field "files", up to 10)
exports.createFromDocuments = async (req, res) => {
  const files = req.files || [];
  try {
    if (!files.length) return res.status(400).json({ success: false, message: 'Please attach at least one document.' });

    let combinedText = '';
    for (const f of files) {
      try {
        const text = await extractText(f.path, f.originalname);
        combinedText += `\n\n--- ${f.originalname} ---\n${text}`;
      } catch (err) {
        return res.status(400).json({ success: false, message: `${f.originalname}: ${err.message}` });
      }
    }
    combinedText = combinedText.trim().slice(0, MAX_CHARS);
    if (!combinedText) return res.status(400).json({ success: false, message: 'No extractable text found in the uploaded document(s) — scanned/image-only PDFs are not supported here.' });

    let extracted = {};
    if (await isOllamaAvailable()) {
      const raw = await ollamaChat(EXTRACTION_SYSTEM_PROMPT, combinedText.slice(0, 12000));
      extracted = parseJsonResponse(raw) || {};
    }

    const tenderRef = (req.body.tenderRef || '').trim() || extracted.tender_ref || `OFFLINE-${Date.now()}`;
    const sourceChoice = req.body.source && req.body.source !== 'auto' ? req.body.source : (extracted.source_guess === 'gem' ? 'gem' : 'open');
    const divisionChoice = req.body.division && req.body.division !== 'auto' ? req.body.division : (extracted.division_guess || null);
    const deptValue = divisionChoice === 'both' ? 'endo' : (divisionChoice || null);

    const permDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'tender-documents', tenderRef.replace(/[^a-zA-Z0-9._-]/g, '_'));
    if (!fs.existsSync(permDir)) fs.mkdirSync(permDir, { recursive: true });
    const savedFiles = files.map((f) => {
      const dest = path.join(permDir, path.basename(f.path));
      fs.renameSync(f.path, dest);
      return f.originalname;
    });

    let insertedId;
    if (sourceChoice === 'gem') {
      await sequelize.query(
        `INSERT INTO gem_tenders (bid_number, items, department, dept, state, emd_amount, bid_value, start_date, end_date, perfect_cat, json_data, created_at, updated_at)
         VALUES (:bid, :items, :organisation, :dept, :state, :emd, :value, :opening, :closing, 1, :json, NOW(), NOW())
         ON DUPLICATE KEY UPDATE items = VALUES(items), state = VALUES(state), emd_amount = VALUES(emd_amount), bid_value = VALUES(bid_value), perfect_cat = 1, updated_at = NOW()`,
        {
          replacements: {
            bid: tenderRef,
            items: extracted.title || tenderRef,
            organisation: extracted.organisation_name || null,
            dept: deptValue,
            state: extracted.state || null,
            emd: extracted.emd_amount || null,
            value: extracted.tender_value || null,
            opening: extracted.opening_date || null,
            closing: extracted.closing_date || null,
            json: JSON.stringify({ ...extracted, uploaded_files: savedFiles, source: 'offline-upload', uploaded_by: req.user.id }),
          },
        },
      );
      const [[row]] = await sequelize.query('SELECT id FROM gem_tenders WHERE bid_number = :bid', { replacements: { bid: tenderRef }, type: QueryTypes.SELECT }).then((r) => [r]);
      insertedId = row?.id;
    } else {
      await sequelize.query(
        `INSERT INTO open_tender_details (tender_id, tender_title, tender_refno, organisation_name, state, closing_date, opening_date, emd_amount, tender_value, product_category, dept, tender_details, downloaded_documents, relevency_checker)
         VALUES (:tenderId, :title, :ref, :organisation, :state, :closing, :opening, :emd, :value, :category, :dept, :details, :docs, 'yes')
         ON DUPLICATE KEY UPDATE tender_title = VALUES(tender_title), state = VALUES(state), emd_amount = VALUES(emd_amount), tender_value = VALUES(tender_value), relevency_checker = 'yes'`,
        {
          replacements: {
            tenderId: tenderRef,
            title: extracted.title || tenderRef,
            ref: tenderRef,
            organisation: extracted.organisation_name || null,
            state: extracted.state || null,
            closing: extracted.closing_date || null,
            opening: extracted.opening_date || null,
            emd: extracted.emd_amount || null,
            value: extracted.tender_value || null,
            category: extracted.item_category || null,
            dept: deptValue,
            details: extracted.eligibility_summary || null,
            docs: JSON.stringify(savedFiles),
          },
        },
      );
      const [[row]] = await sequelize.query('SELECT row_id FROM open_tender_details WHERE tender_refno = :ref', { replacements: { ref: tenderRef }, type: QueryTypes.SELECT }).then((r) => [r]);
      insertedId = row?.row_id;
    }

    res.json({
      success: true,
      data: { id: insertedId, tenderRef, source: sourceChoice, division: divisionChoice, extracted },
    });
  } catch (err) {
    console.error('createFromDocuments error:', err);
    for (const f of files) { if (fs.existsSync(f.path)) fs.unlink(f.path, () => {}); }
    res.status(500).json({ success: false, message: err.message || 'Failed to create tender from documents' });
  }
};
