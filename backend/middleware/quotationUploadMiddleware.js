const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Sales & Invoices > Quotations — business logo shown on the generated PDF
// (image only) and the raw file for a quotation the partner already has
// from elsewhere and just wants to upload/track ("Upload Quotation").
const logoDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'quotations', 'logos');
const fileDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'quotations', 'files');
for (const dir of [logoDir, fileDir]) if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const makeStorage = (dir, prefix) => multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename: (req, file, cb) => cb(null, `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});

const logoFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (/jpe?g|png/.test(ext)) return cb(null, true);
  cb(new Error('Logo must be a JPG or PNG image'));
};

const quotationFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (/pdf|docx?|xlsx?|jpe?g|png/.test(ext)) return cb(null, true);
  cb(new Error('Invalid file type. Allowed: PDF, Word, Excel, JPG, PNG'));
};

const uploadLogo = multer({ storage: makeStorage(logoDir, 'logo'), fileFilter: logoFileFilter, limits: { fileSize: 20 * 1024 * 1024 } });
const uploadQuotationFile = multer({ storage: makeStorage(fileDir, 'quotation'), fileFilter: quotationFileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

module.exports = { uploadLogo, uploadQuotationFile };
