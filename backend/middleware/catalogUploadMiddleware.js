const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Product Management > Our Products — catalog document uploads (for future
// AI extraction of products/specs). Same broad-file-type policy as the
// Library/Workspace uploaders, separate disk folder.
const uploadDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'catalogs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `catalog-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const allowedExt = /pdf|docx?|xlsx?|pptx?|csv|jpe?g|png/;
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (allowedExt.test(ext)) return cb(null, true);
  cb(new Error('Invalid file type. Allowed: PDF, Word, Excel, PowerPoint, CSV, JPG, PNG'));
};

const maxSizeMB = parseInt(process.env.LIBRARY_MAX_FILE_SIZE_MB, 10) || 50;

module.exports = multer({ storage, fileFilter, limits: { fileSize: maxSizeMB * 1024 * 1024 } });
