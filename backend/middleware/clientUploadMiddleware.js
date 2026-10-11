const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Sales & Invoices > Our Clients — logo uploads (image only, 20MB per the
// Add Client form's own copy) and general attachments (broader file types,
// same policy as Library/Workspace uploads).
const logoDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'clients', 'logos');
const attachDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'clients', 'attachments');
for (const dir of [logoDir, attachDir]) if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const makeStorage = (dir, prefix) => multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename: (req, file, cb) => cb(null, `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});

const logoFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (/jpe?g|png/.test(ext)) return cb(null, true);
  cb(new Error('Logo must be a JPG or PNG image'));
};

const attachmentFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (/pdf|docx?|xlsx?|pptx?|csv|txt|zip|jpe?g|png/.test(ext)) return cb(null, true);
  cb(new Error('Invalid file type. Allowed: PDF, Word, Excel, PowerPoint, CSV, TXT, ZIP, JPG, PNG'));
};

const uploadLogo = multer({ storage: makeStorage(logoDir, 'logo'), fileFilter: logoFileFilter, limits: { fileSize: 20 * 1024 * 1024 } });
const uploadAttachment = multer({ storage: makeStorage(attachDir, 'file'), fileFilter: attachmentFileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

module.exports = { uploadLogo, uploadAttachment };
