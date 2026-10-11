const multer = require('multer');
const path = require('path');
const fs = require('fs');

const dir = path.join(process.env.UPLOAD_DIR || 'uploads', 'tender-documents');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename: (req, file, cb) => cb(null, `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (/^(pdf|docx?|txt|csv|xlsx?)$/.test(ext)) return cb(null, true);
  cb(new Error('Unsupported file type. Allowed: PDF, DOC, DOCX, TXT, CSV, XLS, XLSX'));
};

const uploadTenderDocuments = multer({ storage, fileFilter, limits: { fileSize: 30 * 1024 * 1024, files: 10 } });

module.exports = { uploadTenderDocuments };
