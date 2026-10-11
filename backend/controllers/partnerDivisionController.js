'use strict';
// View Profile > Products & Document Format — a partner's own product
// catalogue and branding assets (letterhead/signature/footer/watermark),
// organised by which of Meril's divisions they declared during Setup Profile
// (PartnerProfile.departmentDivisions). Everything here is scoped by
// req.user.id like the rest of the app (staff tokens carry the org owner's id).
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { PartnerDivisionProduct, PartnerDivisionDocument, PartnerProfile } = require('../models');
const { resolveActor } = require('../utils/orgActor');
const DIVISIONS = require('../config/departmentDivisions');

const PRODUCT_UPLOAD_DIR = path.join(__dirname, '../uploads/partner-products');
const DOC_UPLOAD_DIR = path.join(__dirname, '../uploads/partner-documents');
fs.mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DOC_UPLOAD_DIR, { recursive: true });

const imageStorage = (dir) => multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${file.originalname.replace(/[^a-z0-9._-]+/gi, '_')}`),
});
const productUpload = multer({ storage: imageStorage(PRODUCT_UPLOAD_DIR), limits: { fileSize: 15 * 1024 * 1024 } });
const docUpload = multer({ storage: imageStorage(DOC_UPLOAD_DIR), limits: { fileSize: 8 * 1024 * 1024 } });
const excelUpload = multer({
  storage: imageStorage(PRODUCT_UPLOAD_DIR),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => (/\.(xlsx|xls)$/i.test(file.originalname) ? cb(null, true) : cb(new Error('Only .xlsx or .xls files are accepted'))),
});

exports.productUploadMiddleware = productUpload.fields([{ name: 'image', maxCount: 1 }, { name: 'brochure', maxCount: 1 }]);
exports.docUploadMiddleware = docUpload.fields([
  { name: 'letterhead', maxCount: 1 }, { name: 'signature', maxCount: 1 }, { name: 'footer', maxCount: 1 }, { name: 'watermark', maxCount: 1 },
]);
exports.excelUploadMiddleware = excelUpload.single('file');

const actorName = async (req) => { try { return (await resolveActor(req))?.actorName || null; } catch (_) { return null; } };
const nz = (v) => (v === '' || v === undefined ? null : v);

// @route GET /api/partner-divisions
// This partner's own declared divisions, plus a small starting-point
// suggestion list (Meril's well-known divisions) — not an enum, see suggestDivisions.
exports.listDivisions = async (req, res) => {
  try {
    const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
    res.json({ success: true, suggestions: DIVISIONS, selected: profile?.departmentDivisions || [], documentsShared: profile?.documentsShared !== false });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load divisions' });
  }
};

// @route GET /api/partner-divisions/suggest?q=
// Autocomplete while typing a division name: Meril's own well-known
// divisions plus whatever divisions other organisations on the portal have
// already typed in (real usage), so common naming converges over time
// without forcing every org into a fixed list. Typing something that
// matches nothing here is still a perfectly valid, brand-new division for
// that one organisation — the caller decides what to do with no matches.
exports.suggestDivisions = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = await PartnerProfile.findAll({ attributes: ['departmentDivisions'], where: {} });
    const seen = new Map(); // lowercase -> original casing (first one wins)
    [...DIVISIONS, ...rows.flatMap((r) => r.departmentDivisions || [])].forEach((d) => {
      const key = String(d || '').trim();
      if (key && !seen.has(key.toLowerCase())) seen.set(key.toLowerCase(), key);
    });
    const all = [...seen.values()];
    const matches = q ? all.filter((d) => d.toLowerCase().includes(q)) : all;
    res.json({ success: true, data: matches.slice(0, 12) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load suggestions' });
  }
};

// ---- Products ----------------------------------------------------------

// @route GET /api/partner-divisions/products?division=
exports.listProducts = async (req, res) => {
  try {
    const where = { userId: req.user.id };
    if (req.query.division) where.division = req.query.division;
    const rows = await PartnerDivisionProduct.findAll({ where, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load products' });
  }
};

// @route POST /api/partner-divisions/products  multipart: division, productCode, productName, category, description, image?, brochure?
exports.createProduct = async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.division) return res.status(400).json({ success: false, message: 'Division is required' });
    if (!String(b.productName || '').trim()) return res.status(400).json({ success: false, message: 'Product name is required' });
    const files = req.files || {};
    const image = files.image?.[0];
    const brochure = files.brochure?.[0];
    const row = await PartnerDivisionProduct.create({
      userId: req.user.id, division: b.division, productCode: nz(b.productCode), productName: b.productName.trim(),
      category: nz(b.category), description: nz(b.description),
      imageUrl: image ? `/uploads/partner-products/${path.basename(image.path)}` : null,
      brochureUrl: brochure ? `/uploads/partner-products/${path.basename(brochure.path)}` : null,
      brochureFileName: brochure ? brochure.originalname : null,
      source: 'manual', createdByName: await actorName(req),
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error('createProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to add product' });
  }
};

const EDITABLE_PRODUCT_FIELDS = ['productCode', 'productName', 'category', 'description'];

// @route PATCH /api/partner-divisions/products/:id  multipart, all fields optional
exports.updateProduct = async (req, res) => {
  try {
    const row = await PartnerDivisionProduct.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Product not found' });
    const b = req.body || {};
    EDITABLE_PRODUCT_FIELDS.forEach((f) => { if (b[f] !== undefined) row[f] = nz(typeof b[f] === 'string' ? b[f].trim() : b[f]); });
    const files = req.files || {};
    if (files.image?.[0]) {
      if (row.imageUrl) fs.unlink(path.join(__dirname, '..', row.imageUrl), () => {});
      row.imageUrl = `/uploads/partner-products/${path.basename(files.image[0].path)}`;
    }
    if (files.brochure?.[0]) {
      if (row.brochureUrl) fs.unlink(path.join(__dirname, '..', row.brochureUrl), () => {});
      row.brochureUrl = `/uploads/partner-products/${path.basename(files.brochure[0].path)}`;
      row.brochureFileName = files.brochure[0].originalname;
    }
    await row.save();
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update product' });
  }
};

// @route DELETE /api/partner-divisions/products/:id
exports.removeProduct = async (req, res) => {
  try {
    const row = await PartnerDivisionProduct.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Product not found' });
    [row.imageUrl, row.brochureUrl].forEach((u) => { if (u) fs.unlink(path.join(__dirname, '..', u), () => {}); });
    await row.destroy();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete product' });
  }
};

// @route POST /api/partner-divisions/products/bulk  multipart: division, file (.xlsx)
// Expected columns (case-insensitive, any order): Product Code, Product Name, Category, Description.
exports.bulkUploadProducts = async (req, res) => {
  try {
    const division = req.body?.division;
    if (!division) return res.status(400).json({ success: false, message: 'Division is required' });
    if (!req.file) return res.status(400).json({ success: false, message: 'An Excel file is required' });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(req.file.path);
    const sheet = wb.worksheets[0];
    if (!sheet) return res.status(400).json({ success: false, message: 'The Excel file has no sheet' });

    const headerRow = sheet.getRow(1).values.map((v) => String(v || '').trim().toLowerCase());
    const colIndex = (...names) => headerRow.findIndex((h) => names.includes(h));
    const iCode = colIndex('product code', 'code', 'sku');
    const iName = colIndex('product name', 'name');
    const iCat = colIndex('category', 'product category');
    const iDesc = colIndex('description', 'bio data', 'biodata', 'specification', 'specifications');

    if (iName < 0) return res.status(400).json({ success: false, message: 'Could not find a "Product Name" column in the sheet' });

    const by = await actorName(req);
    const toCreate = [];
    let skipped = 0;
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      if (row.values.length === 0) continue;
      const name = String(row.values[iName] || '').trim();
      if (!name) { skipped += 1; continue; }
      toCreate.push({
        userId: req.user.id, division, productName: name,
        productCode: iCode >= 0 ? nz(String(row.values[iCode] || '').trim()) : null,
        category: iCat >= 0 ? nz(String(row.values[iCat] || '').trim()) : null,
        description: iDesc >= 0 ? nz(String(row.values[iDesc] || '').trim()) : null,
        source: 'bulk', createdByName: by,
      });
    }
    if (toCreate.length) await PartnerDivisionProduct.bulkCreate(toCreate);
    fs.unlink(req.file.path, () => {});
    res.status(201).json({ success: true, created: toCreate.length, skipped });
  } catch (err) {
    console.error('bulkUploadProducts error:', err);
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ success: false, message: 'Failed to process the Excel file — check it matches the expected columns.' });
  }
};

// ---- Document Format (letterhead / signature / footer / watermark) -----

const ASSET_FIELDS = { letterhead: 'letterheadUrl', signature: 'signatureUrl', footer: 'footerUrl', watermark: 'watermarkUrl' };

// @route GET /api/partner-divisions/documents
exports.listDocuments = async (req, res) => {
  try {
    const rows = await PartnerDivisionDocument.findAll({ where: { userId: req.user.id } });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load documents' });
  }
};

// @route PATCH /api/partner-divisions/documents/mode  { shared: true|false }
exports.setDocumentMode = async (req, res) => {
  try {
    const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ success: false, message: 'Complete your organisation profile first' });
    profile.documentsShared = !!req.body?.shared;
    await profile.save();
    res.json({ success: true, documentsShared: profile.documentsShared });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update document mode' });
  }
};

// @route POST /api/partner-divisions/documents/:division  multipart: letterhead?, signature?, footer?, watermark?
// division is a real division key, or '__common__' when documentsShared is on.
exports.upsertDocument = async (req, res) => {
  try {
    const division = req.params.division;
    const files = req.files || {};
    if (!Object.keys(ASSET_FIELDS).some((f) => files[f]?.[0])) {
      return res.status(400).json({ success: false, message: 'Attach at least one file' });
    }
    let row = await PartnerDivisionDocument.findOne({ where: { userId: req.user.id, division } });
    if (!row) row = await PartnerDivisionDocument.create({ userId: req.user.id, division });

    Object.entries(ASSET_FIELDS).forEach(([field, col]) => {
      const f = files[field]?.[0];
      if (!f) return;
      if (row[col]) fs.unlink(path.join(__dirname, '..', row[col]), () => {});
      row[col] = `/uploads/partner-documents/${path.basename(f.path)}`;
    });
    row.updatedByName = await actorName(req);
    await row.save();
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('upsertDocument error:', err);
    res.status(500).json({ success: false, message: 'Failed to upload document' });
  }
};

// @route DELETE /api/partner-divisions/documents/:division/:field
exports.removeDocumentAsset = async (req, res) => {
  try {
    const { division, field } = req.params;
    const col = ASSET_FIELDS[field];
    if (!col) return res.status(400).json({ success: false, message: 'Unknown asset field' });
    const row = await PartnerDivisionDocument.findOne({ where: { userId: req.user.id, division } });
    if (!row || !row[col]) return res.status(404).json({ success: false, message: 'Nothing to remove' });
    fs.unlink(path.join(__dirname, '..', row[col]), () => {});
    row[col] = null;
    await row.save();
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove asset' });
  }
};
