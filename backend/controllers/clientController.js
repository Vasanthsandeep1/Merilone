const fs = require('fs');
const { Op } = require('sequelize');
const {
  Client, ClientShippingDetail, ClientContactLink, ClientAttachment, PartnerContact, PartnerProfile,
} = require('../models');

// Sales & Invoices > Our Clients — see Client.js for the per-partner
// scoping rationale. Invoices/Trust-Score are intentionally left as honest
// empty states (see routes below) rather than backed by fabricated data —
// there's no invoicing/payments system in this app to derive them from.

const INCLUDE_FULL = [
  { model: ClientShippingDetail, as: 'shippingDetails' },
  { model: ClientContactLink, as: 'contactLinks', include: [{ model: PartnerContact, as: 'contact' }] },
  { model: ClientAttachment, as: 'attachments' },
];

function uniqueKey() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

// multer gives back an OS-native disk path (backslashes on Windows) — the
// frontend needs a forward-slash URL served by the /uploads static route.
function toPublicPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.indexOf('uploads/');
  return idx === -1 ? `/${normalized}` : `/${normalized.slice(idx)}`;
}

// @route GET /api/clients
exports.listClients = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const { search, clientKind, industry, country, status } = req.query;

    const where = { userId: req.user.id };
    if (search) {
      where[Op.or] = [
        { businessName: { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }
    if (clientKind) where.clientKind = clientKind;
    if (industry) where.industry = industry;
    if (country) where.country = country;
    where.status = status || 'Active';

    const { rows, count } = await Client.findAndCountAll({ where, order: [['createdAt', 'DESC']], limit, offset });

    res.json({
      success: true,
      data: rows.map((r) => r.toJSON()),
      total: count,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(count / limit)),
    });
  } catch (err) {
    console.error('listClients error:', err);
    res.status(500).json({ success: false, message: 'Failed to load clients' });
  }
};

// @route GET /api/clients/filters — distinct industries/countries for the filter dropdowns
exports.getClientFilters = async (req, res) => {
  try {
    const [industries, countries] = await Promise.all([
      Client.findAll({ where: { userId: req.user.id, industry: { [Op.ne]: null } }, attributes: ['industry'], group: ['industry'] }),
      Client.findAll({ where: { userId: req.user.id, country: { [Op.ne]: null } }, attributes: ['country'], group: ['country'] }),
    ]);
    res.json({
      success: true,
      industries: industries.map((r) => r.industry).filter(Boolean),
      countries: countries.map((r) => r.country).filter(Boolean),
    });
  } catch (err) {
    console.error('getClientFilters error:', err);
    res.status(500).json({ success: false, message: 'Failed to load filters' });
  }
};

// @route GET /api/clients/export.csv
exports.exportCsv = async (req, res) => {
  try {
    const rows = await Client.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
    const header = ['Name', 'Type', 'Industry', 'Phone', 'Email', 'Country', 'Status', 'Last Communication Date'];
    const escape = (v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
    const lines = [header.join(',')];
    for (const c of rows) {
      lines.push([c.businessName, c.clientKind, c.industry, c.phone, c.email, c.country, c.status, c.lastCommunicationDate]
        .map(escape).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="clients.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('exportCsv error:', err);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};

// @route GET /api/clients/:id
exports.getClient = async (req, res) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id }, include: INCLUDE_FULL });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true, data: client.toJSON() });
  } catch (err) {
    console.error('getClient error:', err);
    res.status(500).json({ success: false, message: 'Failed to load client' });
  }
};

const CLIENT_FIELDS = [
  'businessName', 'clientKind', 'clientType', 'industry', 'taxTreatment', 'gstin', 'pan', 'businessAlias',
  'email', 'showEmailInInvoice', 'phone', 'showPhoneInInvoice', 'defaultDueDays',
  'country', 'state', 'city', 'postalCode', 'streetAddress', 'lastCommunicationDate', 'customFields',
];

// @route POST /api/clients   (multipart, optional field "logo")
exports.createClient = async (req, res) => {
  try {
    if (!req.body.businessName?.trim()) return res.status(400).json({ success: false, message: 'Business Name is required' });

    const payload = { userId: req.user.id, uniqueKey: uniqueKey() };
    for (const f of CLIENT_FIELDS) if (req.body[f] !== undefined && req.body[f] !== '') payload[f] = req.body[f];
    if (req.file) payload.logoPath = toPublicPath(req.file.path);

    const client = await Client.create(payload);
    res.json({ success: true, data: client.toJSON() });
  } catch (err) {
    console.error('createClient error:', err);
    res.status(500).json({ success: false, message: 'Failed to create client' });
  }
};

// @route PATCH /api/clients/:id   (multipart, optional field "logo")
exports.updateClient = async (req, res) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    for (const f of CLIENT_FIELDS) if (req.body[f] !== undefined) client[f] = req.body[f] || null;
    if (req.file) {
      const oldDiskPath = client.logoPath ? client.logoPath.replace(/^\//, '') : null;
      if (oldDiskPath && fs.existsSync(oldDiskPath)) fs.unlink(oldDiskPath, () => {});
      client.logoPath = toPublicPath(req.file.path);
    }
    await client.save();
    res.json({ success: true, data: client.toJSON() });
  } catch (err) {
    console.error('updateClient error:', err);
    res.status(500).json({ success: false, message: 'Failed to update client' });
  }
};

// @route PATCH /api/clients/:id/archive   { archive: boolean }
exports.setArchived = async (req, res) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    client.status = req.body.archive === false ? 'Active' : 'Archived';
    await client.save();
    res.json({ success: true, data: client.toJSON() });
  } catch (err) {
    console.error('setArchived error:', err);
    res.status(500).json({ success: false, message: 'Failed to update client' });
  }
};

// @route DELETE /api/clients/:id
exports.deleteClient = async (req, res) => {
  try {
    const deleted = await Client.destroy({ where: { id: req.params.id, userId: req.user.id } });
    if (!deleted) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteClient error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete client' });
  }
};

// ---- Shipping details ----

exports.addShippingDetail = async (req, res) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    const { name, country, state, city, postalCode, streetAddress } = req.body;
    const row = await ClientShippingDetail.create({ clientId: client.id, name, country, state, city, postalCode, streetAddress });
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('addShippingDetail error:', err);
    res.status(500).json({ success: false, message: 'Failed to add shipping detail' });
  }
};

exports.deleteShippingDetail = async (req, res) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    await ClientShippingDetail.destroy({ where: { id: req.params.shippingId, clientId: client.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteShippingDetail error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove shipping detail' });
  }
};

// ---- Linked contacts (from this partner's own Setup-Profile contacts) ----

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
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    const { partnerContactId } = req.body;
    if (!partnerContactId) return res.status(400).json({ success: false, message: 'A contact is required' });
    const [link] = await ClientContactLink.findOrCreate({ where: { clientId: client.id, partnerContactId } });
    res.json({ success: true, data: link.toJSON() });
  } catch (err) {
    console.error('linkContact error:', err);
    res.status(500).json({ success: false, message: 'Failed to link contact' });
  }
};

exports.unlinkContact = async (req, res) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    await ClientContactLink.destroy({ where: { id: req.params.linkId, clientId: client.id } });
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
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!client) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    const attachment = await ClientAttachment.create({
      clientId: client.id, fileName: req.file.originalname, filePath: req.file.path, fileSize: req.file.size,
    });
    res.json({ success: true, data: attachment.toJSON() });
  } catch (err) {
    console.error('uploadAttachment error:', err);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

exports.downloadAttachment = async (req, res) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    const attachment = await ClientAttachment.findOne({ where: { id: req.params.attachmentId, clientId: client.id } });
    if (!attachment || !fs.existsSync(attachment.filePath)) return res.status(404).json({ success: false, message: 'File not found' });
    res.download(attachment.filePath, attachment.fileName);
  } catch (err) {
    console.error('downloadAttachment error:', err);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
};

exports.deleteAttachment = async (req, res) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    const attachment = await ClientAttachment.findOne({ where: { id: req.params.attachmentId, clientId: client.id } });
    if (!attachment) return res.status(404).json({ success: false, message: 'File not found' });
    if (fs.existsSync(attachment.filePath)) fs.unlink(attachment.filePath, () => {});
    await attachment.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deleteAttachment error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete attachment' });
  }
};

// @route GET /api/clients/:id/invoices — always empty (no invoicing system
// exists yet); kept as its own endpoint so the frontend's Invoices tab has
// something real to call rather than a hardcoded client-side stub.
exports.getInvoices = async (req, res) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true, data: [] });
  } catch (err) {
    console.error('getInvoices error:', err);
    res.status(500).json({ success: false, message: 'Failed to load invoices' });
  }
};
