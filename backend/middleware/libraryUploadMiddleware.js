const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Separate from uploadMiddleware.js (Setup Profile's PDF/JPG/PNG-only,
// 10MB cap) — the document Library needs to hold whatever a partner's
// day-to-day tender paperwork actually is (Office/PDF/images/CSV/zip),
// at a size that fits real contract/spec documents.
const uploadDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'library');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `file-${uniqueSuffix}${ext}`);
  },
});

const allowedExt = /pdf|docx?|xlsx?|pptx?|csv|txt|zip|jpe?g|png/;
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (allowedExt.test(ext)) return cb(null, true);
  cb(new Error('Invalid file type. Allowed: PDF, Word, Excel, PowerPoint, CSV, TXT, ZIP, JPG, PNG'));
};

const maxSizeMB = parseInt(process.env.LIBRARY_MAX_FILE_SIZE_MB, 10) || 50;

module.exports = multer({ storage, fileFilter, limits: { fileSize: maxSizeMB * 1024 * 1024 } });
