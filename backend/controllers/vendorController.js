const fs = require('fs');
const { Op } = require('sequelize');
const {
  Vendor, VendorContactLink, VendorAttachment, PartnerContact, PartnerProfile,
} = require('../models');

// Purchases & Expenses > Our Vendors — see Vendor.js for the per-partner
// scoping rationale and how this differs from Client.

const INCLUDE_FULL = [
  { model: VendorContactLink, as: 'contactLinks', include: [{ model: PartnerContact, as: 'contact' }] },
  { model: VendorAttachment, as: 'attachments' },
];

function uniqueKey() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function toPublicPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.indexOf('uploads/');
  return idx === -1 ? `/${normalized}` : `/${normalized.slice(idx)}`;
}

// @route GET /api/vendors
exports.listVendors = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const { search, industry, country, status } = req.query;

    const where = { userId: req.user.id };
    if (search) {
      where[Op.or] = [
        { businessName: { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }
    if (industry) where.industry = industry;
    if (country) where.country = country;
    where.status = status || 'Active';

    const { rows, count } = await Vendor.findAndCountAll({ where, order: [['createdAt', 'DESC']], limit, offset });

    res.json({
      success: true,
      data: rows.map((r) => r.toJSON()),
      total: count,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(count / limit)),
    });
  } catch (err) {
    console.error('listVendors error:', err);
    res.status(500).json({ success: false, message: 'Failed to load vendors' });
  }
};

// @route GET /api/vendors/filters
exports.getVendorFilters = async (req, res) => {
  try {
    const [industries, countries] = await Promise.all([
      Vendor.findAll({ where: { userId: req.user.id, industry: { [Op.ne]: null } }, attributes: ['industry'], group: ['industry'] }),
      Vendor.findAll({ where: { userId: req.user.id, country: { [Op.ne]: null } }, attributes: ['country'], group: ['country'] }),
    ]);
    res.json({
      success: true,
      industries: industries.map((r) => r.industry).filter(Boolean),
      countries: countries.map((r) => r.country).filter(Boolean),
    });
  } catch (err) {
    console.error('getVendorFilters error:', err);
    res.status(500).json({ success: false, message: 'Failed to load filters' });
  }
};

// @route GET /api/vendors/export.csv
exports.exportCsv = async (req, res) => {
  try {
    const rows = await Vendor.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
    const header = ['Name', 'Industry', 'Phone', 'Email', 'Country', 'Status'];
    const escape = (v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
    const lines = [header.join(',')];
    for (const v of rows) {
      lines.push([v.businessName, v.industry, v.phone, v.email, v.country, v.status].map(escape).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="vendors.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('exportCsv error:', err);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};

// @route GET /api/vendors/:id
exports.getVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ where: { id: req.params.id, userId: req.user.id }, include: INCLUDE_FULL });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, data: vendor.toJSON() });
  } catch (err) {
    console.error('getVendor error:', err);
    res.status(500).json({ success: false, message: 'Failed to load vendor' });
  }
};

const VENDOR_FIELDS = [
  'businessName', 'vendorType', 'industry', 'taxTreatment', 'gstin', 'pan', 'displayName',
  'email', 'showEmailInInvoice', 'phone', 'showPhoneInInvoice', 'defaultDueDays',
  'country', 'state', 'city', 'postalCode', 'streetAddress', 'customFields',
];

function parseJsonField(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// @route POST /api/vendors   (multipart, optional field "logo")
exports.createVendor = async (req, res) => {
  try {
    if (!req.body.businessName?.trim()) return res.status(400).json({ success: false, message: "Vendor's Business Name is required" });

    const payload = { userId: req.user.id, uniqueKey: uniqueKey() };
    for (const f of VENDOR_FIELDS) if (req.body[f] !== undefined && req.body[f] !== '') payload[f] = req.body[f];
    if (req.body.bankAccounts !== undefined) payload.bankAccounts = parseJsonField(req.body.bankAccounts);
    if (req.file) payload.logoPath = toPublicPath(req.file.path);

    const vendor = await Vendor.create(payload);
    res.json({ success: true, data: vendor.toJSON() });
  } catch (err) {
    console.error('createVendor error:', err);
    res.status(500).json({ success: false, message: 'Failed to create vendor' });
  }
};

// @route PATCH /api/vendors/:id   (multipart, optional field "logo")
exports.updateVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    for (const f of VENDOR_FIELDS) if (req.body[f] !== undefined) vendor[f] = req.body[f] || null;
    if (req.body.bankAccounts !== undefined) vendor.bankAccounts = parseJsonField(req.body.bankAccounts);
    if (req.file) {
      const oldDiskPath = vendor.logoPath ? vendor.logoPath.replace(/^\//, '') : null;
      if (oldDiskPath && fs.existsSync(oldDiskPath)) fs.unlink(oldDiskPath, () => {});
      vendor.logoPath = toPublicPath(req.file.path);
    }
    await vendor.save();
    res.json({ success: true, data: vendor.toJSON() });
  } catch (err) {
    console.error('updateVendor error:', err);
    res.status(500).json({ success: false, message: 'Failed to update vendor' });
  }
};

// @route PATCH /api/vendors/:id/archive   { archive: boolean }
exports.setArchived = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    vendor.status = req.body.archive === false ? 'Active' : 'Archived';
    await vendor.save();
    res.json({ success: true, data: vendor.toJSON() });
  } catch (err) {
    console.error('setArchived error:', err);
    res.status(500).json({ success: false, message: 'Failed to update vendor' });
  }
};

// @route DELETE /api/vendors/:id
exports.deleteVendor = async (req, res) => {
  try {
    const deleted = await Vendor.destroy({ where: { id: req.params.id, userId: req.user.id } });
    if (!deleted) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteVendor error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete vendor' });
  }
};

// ---- Linked contacts ----

exports.getAvailableContacts = async (req, res) => {
  try {
    const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
    if (!profile) return res.json({ success: true, data: [] });
    const contacts = await PartnerContact.findAll({ where: { profileId: profile.id } });
    res.json({ success: true, data: contacts.map((c) => c.toJSON()) });
  } catch (err) {
    console.error('getAvailableContacts error:', err);
    res.status(500).json({ success: false, message: 'Failed to load contacts' });
  }
};

exports.linkContact = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    const { partnerContactId } = req.body;
    if (!partnerContactId) return res.status(400).json({ success: false, message: 'A contact is required' });
    const [link] = await VendorContactLink.findOrCreate({ where: { vendorId: vendor.id, partnerContactId } });
    res.json({ success: true, data: link.toJSON() });
  } catch (err) {
    console.error('linkContact error:', err);
    res.status(500).json({ success: false, message: 'Failed to link contact' });
  }
};

exports.unlinkContact = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    await VendorContactLink.destroy({ where: { id: req.params.linkId, vendorId: vendor.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('unlinkContact error:', err);
    res.status(500).json({ success: false, message: 'Failed to unlink contact' });
  }
};

// ---- Attachments ----

exports.uploadAttachment = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const vendor = await Vendor.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!vendor) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    const attachment = await VendorAttachment.create({
      vendorId: vendor.id, fileName: req.file.originalname, filePath: req.file.path, fileSize: req.file.size,
    });
    res.json({ success: true, data: attachment.toJSON() });
  } catch (err) {
    console.error('uploadAttachment error:', err);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

exports.downloadAttachment = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    const attachment = await VendorAttachment.findOne({ where: { id: req.params.attachmentId, vendorId: vendor.id } });
    if (!attachment || !fs.existsSync(attachment.filePath)) return res.status(404).json({ success: false, message: 'File not found' });
    res.download(attachment.filePath, attachment.fileName);
  } catch (err) {
    console.error('downloadAttachment error:', err);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
};

exports.deleteAttachment = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    const attachment = await VendorAttachment.findOne({ where: { id: req.params.attachmentId, vendorId: vendor.id } });
    if (!attachment) return res.status(404).json({ success: false, message: 'File not found' });
    if (fs.existsSync(attachment.filePath)) fs.unlink(attachment.filePath, () => {});
    await attachment.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deleteAttachment error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete attachment' });
  }
};
