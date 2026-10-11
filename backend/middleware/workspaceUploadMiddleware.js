const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Tender Hub > Documents tab uploads — same broad file-type policy as the
// Library (backend/middleware/libraryUploadMiddleware.js), separate disk
// folder so the two feature's files don't mix.
const uploadDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'workspace');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `file-${uniqueSuffix}${path.extname(file.originalname)}`);
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
