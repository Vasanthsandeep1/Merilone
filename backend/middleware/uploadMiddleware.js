const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const uploadDir = process.env.UPLOAD_DIR || 'uploads';

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// Setup Profile documents (logo, certificates, tax registration docs) are
// PDF/JPG/JPEG/PNG only, per SETUP_PROFILE.txt section 12.
const fileFilter = (req, file, cb) => {
  const allowedExt = /jpeg|jpg|png|pdf/;
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (allowedExt.test(ext)) return cb(null, true);
  cb(new Error('Invalid file type. Allowed: PDF, JPG, JPEG, PNG'));
};

const maxSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10;

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxSizeMB * 1024 * 1024 }
});

module.exports = upload;
