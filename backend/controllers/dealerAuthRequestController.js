const { Op } = require('sequelize');
const path = require('path');
const {
  User, PartnerProfile, PartnerContact, PartnerCertificate, PartnerTaxRegistration,
  CompanyCategory, CompanySubCategory, ProductMasterItem, PartnerProductSelection,
  DealerAuthRequest, DealerAuthRequestItem, DealerAuthRequestDocument, ResellerProduct, StaffUser,
  GemTender, GemTenderDoc, OpenTenderDetail,
} = require('../models');
const fs = require('fs');
const { notify } = require('../utils/notify');
const { renderPdf } = require('../utils/letterPdf');
const { inferDivision, buildLetterHtml, AUTH_TYPE_LABELS } = require('../utils/authorizationLetter');
const { sendMail, isMailConfigured } = require('../utils/mailer');

// Dealer Management > Request Authorization — a reseller asks a specific
// OEM (another real partner account on this platform) for permission to
// sell one of that OEM's own products (drawn from what that OEM actually
// selected in their Setup Profile — see PartnerProductSelection.js), for a
// stated validity window. The OEM approves/rejects; either action notifies
// the reseller. See DealerAuthRequest.js for the cross-tenant reasoning.

const companyLabel = (profile) => {
  const info = profile?.companyInfo || {};
  return info.tradeName || info.legalName || info.shortName || null;
};

// @route GET /api/dealer-requests/oems?q=
exports.listOems = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const users = await User.findAll({
      where: { userType: 'partner', partnerType: 'oem', profileSubmitted: true, id: { [Op.ne]: req.user.id } },
      include: [{ model: PartnerProfile, as: 'partnerProfile' }],
    });
    const data = users
      .map((u) => ({ userId: u.id, name: companyLabel(u.partnerProfile) || u.name, email: u.email }))
      .filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
    res.json({ success: true, data });
  } catch (err) {
    console.error('listOems error:', err);
    res.status(500).json({ success: false, message: 'Failed to load OEM list' });
  }
};

async function oemProfileId(oemUserId) {
  const profile = await PartnerProfile.findOne({ where: { userId: oemUserId } });
  return profile?.id || null;
}

// @route GET /api/dealer-requests/oems/:oemUserId/categories
exports.listOemCategories = async (req, res) => {
  try {
    const profileId = await oemProfileId(req.params.oemUserId);
    if (!profileId) return res.json({ success: true, data: [] });
    const selections = await PartnerProductSelection.findAll({
      where: { profileId, categoryId: { [Op.ne]: null } },
      include: [{ model: CompanyCategory, as: 'category' }],
    });
    const seen = new Map();
    for (const s of selections) if (s.category && !seen.has(s.category.id)) seen.set(s.category.id, s.category.name);
    res.json({ success: true, data: [...seen.entries()].map(([id, name]) => ({ id, name })) });
  } catch (err) {
    console.error('listOemCategories error:', err);
    res.status(500).json({ success: false, message: 'Failed to load categories' });
  }
};

// @route GET /api/dealer-requests/oems/:oemUserId/subcategories?categoryId=
exports.listOemSubCategories = async (req, res) => {
  try {
    const profileId = await oemProfileId(req.params.oemUserId);
    if (!profileId) return res.json({ success: true, data: [] });
    const selections = await PartnerProductSelection.findAll({
      where: { profileId, categoryId: req.query.categoryId, subCategoryId: { [Op.ne]: null } },
      include: [{ model: CompanySubCategory, as: 'subCategory' }],
    });
    const seen = new Map();
    for (const s of selections) if (s.subCategory && !seen.has(s.subCategory.id)) seen.set(s.subCategory.id, s.subCategory.name);
    res.json({ success: true, data: [...seen.entries()].map(([id, name]) => ({ id, name })) });
  } catch (err) {
    console.error('listOemSubCategories error:', err);
    res.status(500).json({ success: false, message: 'Failed to load sub-categories' });
  }
};

// @route GET /api/dealer-requests/oems/:oemUserId/products?categoryId=
// Keyed directly off categoryId (not subCategoryId) — the request form only
// asks for Category > Product now, and this also avoids silently hiding
// products whose selection row has an inconsistent/blank sub-category.
exports.listOemProducts = async (req, res) => {
  try {
    const profileId = await oemProfileId(req.params.oemUserId);
    if (!profileId) return res.json({ success: true, data: [] });
    const selections = await PartnerProductSelection.findAll({
      where: { profileId, categoryId: req.query.categoryId },
      include: [{ model: ProductMasterItem, as: 'product' }],
    });
    const data = selections.map((s) => (
      s.product ? { productId: s.product.id, name: s.product.name } : { productId: null, name: s.customProductName, custom: true }
    )).filter((p) => p.name);
    // De-dupe (a product can theoretically be selected more than once).
    const seen = new Set();
    res.json({ success: true, data: data.filter((p) => { const k = p.productId ?? p.name; if (seen.has(k)) return false; seen.add(k); return true; }) });
  } catch (err) {
    console.error('listOemProducts error:', err);
    res.status(500).json({ success: false, message: 'Failed to load products' });
  }
};

async function nextRefNo() {
  const year = new Date().getFullYear();
  const count = await DealerAuthRequest.count();
  return `${year}_auth_${String(count + 1).padStart(4, '0')}`;
}

// MDPL/XXXX/YYYY — the user-facing authorization code shown in listings,
// a running 4-digit sequence plus the current year. Distinct from refNo
// (see DealerAuthRequest.js for why both exist).
async function nextAuthCode() {
  const year = new Date().getFullYear();
  const count = await DealerAuthRequest.count();
  return `MDPL/${String(count + 1).padStart(4, '0')}/${year}`;
}

// @route GET /api/dealer-requests/verify-tender?tenderNo=&tenderType=gem|open
// Checks whether a tender number the reseller typed on the "Tender
// Authorization" requirement step is actually in our portal (gem_tenders /
// open_tender_details — both read-only mirrors of the tender-automation
// system). `autoAttachable` tells the frontend whether documents will be
// fetched automatically once the request is submitted: only real for a GeM
// tender with a live gem.gov.in PDF link (gem_tender_docs.pdf_url) — an Open
// Tender's own documents live on the separate scraper machine's filesystem
// and aren't reachable from this server, so those still need a manual
// upload even when the tender itself is found.
exports.verifyTender = async (req, res) => {
  try {
    const tenderNo = (req.query.tenderNo || '').trim();
    const tenderType = req.query.tenderType;
    if (!tenderNo || !['gem', 'open'].includes(tenderType)) {
      return res.status(400).json({ success: false, message: 'tenderNo and a valid tenderType are required' });
    }

    if (tenderType === 'gem') {
      const tender = await GemTender.findOne({ where: { bidNumber: tenderNo } });
      if (!tender) return res.json({ success: true, exists: false });
      const doc = await GemTenderDoc.findOne({ where: { bidNumber: tenderNo } });
      const documents = doc?.pdfUrl
        ? [{ label: `Tender Document (${tenderNo})`, fileName: `${tenderNo.replace(/\//g, '_')}.pdf`, fetchable: true, url: doc.pdfUrl }]
        : [];
      return res.json({ success: true, exists: true, title: tender.items || null, autoAttachable: documents.length > 0, documents });
    }

    const tender = await OpenTenderDetail.findOne({ where: { tenderRefno: tenderNo } });
    if (!tender) return res.json({ success: true, exists: false });
    // Open Tender documents are real (scraped from the source portal), but
    // live on the separate scraper machine's own filesystem — not reachable
    // from this server — so they're listed by name only, for the reseller
    // to attach by hand, rather than silently shown as auto-fetched.
    const fileLinks = Array.isArray(tender.fileLink) ? tender.fileLink : [];
    const documents = fileLinks
      .map((f) => f && (f.file_name || f.name))
      .filter(Boolean)
      .map((fileName) => ({ label: fileName, fileName, fetchable: false }));
    return res.json({ success: true, exists: true, title: tender.tenderTitle || null, autoAttachable: false, documents });
  } catch (err) {
    console.error('verifyTender error:', err);
    res.status(500).json({ success: false, message: 'Failed to verify tender' });
  }
};

// Fetches the GeM tender's own PDF (a real, public gem.gov.in URL) and saves
// it straight onto the new request's Verification Documents, the way a
// manual "+ Add Other Supporting Document" upload would — just without
// asking the reseller to download and re-upload something we can already
// see is the same document. Best-effort: any failure here (network, a dead
// link) must not fail the request itself, so errors are swallowed.
async function autoAttachTenderDocument(requestId, tenderNumber) {
  try {
    const doc = await GemTenderDoc.findOne({ where: { bidNumber: tenderNumber } });
    if (!doc?.pdfUrl) return;
    const resp = await fetch(doc.pdfUrl, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) return;
    const buf = Buffer.from(await resp.arrayBuffer());

    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filename = `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
    fs.writeFileSync(path.join(uploadDir, filename), buf);

    await DealerAuthRequestDocument.create({
      dealerAuthRequestId: requestId,
      docType: 'other',
      label: `Tender Document (${tenderNumber})`,
      fileUrl: `/uploads/${filename}`,
      fileName: `${tenderNumber.replace(/\//g, '_')}.pdf`,
      fileSize: buf.length,
    });
  } catch (err) {
    console.error('autoAttachTenderDocument failed (non-fatal):', err.message);
  }
}

// @route POST /api/dealer-requests
// body: { toUserId, validFrom, validTo, reason, authType, tenderNumber, tenderType, items: [{ categoryId, subCategoryId, productId, customProductName, productCode, conditionBullets }] }
exports.createRequest = async (req, res) => {
  try {
    const { toUserId, validFrom, validTo, reason } = req.body;
    const authType = ['tender', 'direct_purchase', 'local'].includes(req.body.authType) ? req.body.authType : 'tender';
    const tenderNumber = authType === 'tender' ? (req.body.tenderNumber || '').trim() : null;
    const tenderType = authType === 'tender' && ['gem', 'open'].includes(req.body.tenderType) ? req.body.tenderType : null;
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (authType === 'tender' && (!tenderNumber || !tenderType)) {
      return res.status(400).json({ success: false, message: 'Tender number and tender type are required for a Tender Authorization request' });
    }
    if (!toUserId) return res.status(400).json({ success: false, message: 'Select an OEM' });
    if (!items.length) return res.status(400).json({ success: false, message: 'Add at least one product' });
    if (items.some((it) => !it.productId && !it.customProductName)) {
      return res.status(400).json({ success: false, message: 'Select a product for every row' });
    }
    if (!validFrom || !validTo) return res.status(400).json({ success: false, message: 'Validity from/to dates are required' });
    if (new Date(validTo) < new Date(validFrom)) return res.status(400).json({ success: false, message: 'Validity end date must be after the start date' });

    const oem = await User.findOne({ where: { id: toUserId, userType: 'partner', partnerType: 'oem' } });
    if (!oem) return res.status(404).json({ success: false, message: 'OEM not found' });

    const [refNo, authCode] = await Promise.all([nextRefNo(), nextAuthCode()]);
    const request = await DealerAuthRequest.create({
      refNo, authCode, fromUserId: req.user.id, toUserId,
      authType, tenderNumber, tenderType,
      validFrom, validTo, reason: reason || null, status: 'pending',
    });

    await DealerAuthRequestItem.bulkCreate(items.map((it, idx) => ({
      dealerAuthRequestId: request.id,
      sortOrder: idx,
      categoryId: it.categoryId || null,
      subCategoryId: it.subCategoryId || null,
      productId: it.productId || null,
      customProductName: it.productId ? null : (it.customProductName || null),
      productCode: it.productCode || null,
      conditionBullets: Array.isArray(it.conditionBullets) ? it.conditionBullets.filter((b) => b && b.trim()) : null,
    })));

    if (authType === 'tender' && tenderType === 'gem' && req.body.attachTenderDoc !== false) {
      await autoAttachTenderDocument(request.id, tenderNumber);
    }

    const fromProfile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
    await notify(toUserId, {
      type: 'auth_request',
      title: 'New Authorization Request',
      message: `${companyLabel(fromProfile) || req.user.name || 'A reseller'} has requested authorization (${authCode}).`,
      relatedType: 'DealerAuthRequest', relatedId: request.id,
    });

    res.json({ success: true, data: request.toJSON() });
  } catch (err) {
    console.error('createRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit request' });
  }
};

// @route POST /api/dealer-requests/:id/documents   multipart: document, docType, label?
// Only the reseller who sent the request can attach documents to it, and
// only while it's still pending — mirrors the two-step submit wizard on the
// frontend (details -> verification documents -> Submit Request).
exports.uploadDocument = async (req, res) => {
  try {
    const request = await DealerAuthRequest.findOne({ where: { id: req.params.id, fromUserId: req.user.id } });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const { docType, label } = req.body;
    if (!docType) return res.status(400).json({ success: false, message: 'docType is required' });

    const doc = await DealerAuthRequestDocument.create({
      dealerAuthRequestId: request.id,
      docType,
      label: label || null,
      fileUrl: `/uploads/${req.file.filename}`,
      fileName: req.file.originalname,
      fileSize: req.file.size,
    });
    res.json({ success: true, data: doc.toJSON() });
  } catch (err) {
    console.error('uploadDocument error:', err);
    res.status(500).json({ success: false, message: 'Failed to upload document' });
  }
};

// @route DELETE /api/dealer-requests/:id/documents/:docId
exports.removeDocument = async (req, res) => {
  try {
    const request = await DealerAuthRequest.findOne({ where: { id: req.params.id, fromUserId: req.user.id } });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    const doc = await DealerAuthRequestDocument.findOne({ where: { id: req.params.docId, dealerAuthRequestId: request.id } });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    const filePath = doc.fileUrl?.startsWith('/uploads/') ? `uploads/${doc.fileUrl.slice('/uploads/'.length)}` : null;
    await doc.destroy();
    if (filePath) fs.unlink(filePath, () => {});
    res.json({ success: true });
  } catch (err) {
    console.error('removeDocument error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove document' });
  }
};

const REQUEST_INCLUDE = [
  { model: User, as: 'fromUser', attributes: ['id', 'name', 'email'] },
  { model: User, as: 'toUser', attributes: ['id', 'name', 'email'] },
  {
    model: DealerAuthRequestItem,
    as: 'items',
    separate: true,
    order: [['sortOrder', 'ASC']],
    include: [
      { model: CompanyCategory, as: 'category' },
      { model: CompanySubCategory, as: 'subCategory' },
      { model: ProductMasterItem, as: 'product' },
    ],
  },
  { model: DealerAuthRequestDocument, as: 'documents', separate: true, order: [['createdAt', 'ASC']] },
];

async function decorate(rows) {
  const fromProfiles = await PartnerProfile.findAll({ where: { userId: rows.map((r) => r.fromUserId) } });
  const toProfiles = await PartnerProfile.findAll({ where: { userId: rows.map((r) => r.toUserId) } });
  const fromMap = new Map(fromProfiles.map((p) => [p.userId, p]));
  const toMap = new Map(toProfiles.map((p) => [p.userId, p]));
  return rows.map((r) => {
    const json = r.toJSON();
    const items = (json.items || []).map((it) => ({ ...it, productName: it.product?.name || it.customProductName }));
    return {
      ...json,
      items,
      fromCompanyName: companyLabel(fromMap.get(json.fromUserId)) || json.fromUser?.name,
      toCompanyName: companyLabel(toMap.get(json.toUserId)) || json.toUser?.name,
      productName: items.map((it) => it.productName).filter(Boolean).join(', ') || null,
    };
  });
}

// @route GET /api/dealer-requests/sent
exports.listSentRequests = async (req, res) => {
  try {
    const rows = await DealerAuthRequest.findAll({ where: { fromUserId: req.user.id }, include: REQUEST_INCLUDE, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: await decorate(rows) });
  } catch (err) {
    console.error('listSentRequests error:', err);
    res.status(500).json({ success: false, message: 'Failed to load your requests' });
  }
};

// @route GET /api/dealer-requests/received
exports.listReceivedRequests = async (req, res) => {
  try {
    const rows = await DealerAuthRequest.findAll({ where: { toUserId: req.user.id }, include: REQUEST_INCLUDE, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: await decorate(rows) });
  } catch (err) {
    console.error('listReceivedRequests error:', err);
    res.status(500).json({ success: false, message: 'Failed to load incoming requests' });
  }
};

// ---- Authorization Tracker ----
// One role-aware view over dealer_auth_requests for both sides: an OEM sees
// requests addressed to them (counterparty = reseller), a reseller sees
// requests they sent (counterparty = OEM). Status is derived so the tracker
// can show what the stored pending/approved/rejected enum can't: an approved
// authorization that is active, expiring soon, or already expired.
const EXPIRING_SOON_DAYS = 30;

function trackerStatus(r, now) {
  if (r.status === 'pending') return 'pending';
  if (r.status === 'rejected') return 'rejected';
  const validTo = new Date(r.validTo); validTo.setHours(23, 59, 59, 999);
  const validFrom = new Date(r.validFrom);
  if (validTo < now) return 'expired';
  if (validFrom > now) return 'scheduled';
  const daysLeft = Math.ceil((validTo.getTime() - now.getTime()) / 864e5);
  return daysLeft <= EXPIRING_SOON_DAYS ? 'expiring_soon' : 'active';
}

// @route GET /api/dealer-requests/tracker?search=&status=&page=&limit=
exports.listTracker = async (req, res) => {
  try {
    const me = await User.findByPk(req.user.id, { attributes: ['id', 'partnerType'] });
    const side = me?.partnerType === 'reseller' ? 'reseller' : 'oem';
    const where = side === 'oem' ? { toUserId: req.user.id } : { fromUserId: req.user.id };

    const rows = await DealerAuthRequest.findAll({ where, include: REQUEST_INCLUDE, order: [['createdAt', 'DESC']] });
    const decorated = await decorate(rows);
    const now = new Date();

    let items = decorated.map((r) => {
      const status = trackerStatus(r, now);
      const validTo = new Date(r.validTo); validTo.setHours(23, 59, 59, 999);
      return {
        id: r.id,
        refNo: r.refNo,
        authCode: r.authCode,
        counterpartyName: side === 'oem' ? r.fromCompanyName : r.toCompanyName,
        counterpartyEmail: side === 'oem' ? r.fromUser?.email : r.toUser?.email,
        products: (r.items || []).map((it) => ({
          name: it.productName, code: it.productCode, category: it.category?.name || null, conditions: it.conditionBullets || [],
        })),
        documents: (r.documents || []).map((d) => ({
          id: d.id, docType: d.docType, label: d.label, fileUrl: d.fileUrl, fileName: d.fileName, fileSize: d.fileSize,
        })),
        reason: r.reason,
        requestedAt: r.createdAt,
        validFrom: r.validFrom,
        validTo: r.validTo,
        decidedAt: r.decidedAt,
        rejectionRemarks: r.rejectionRemarks,
        daysPending: r.status === 'pending' ? Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / 864e5) : null,
        daysLeft: ['active', 'expiring_soon'].includes(status) ? Math.ceil((validTo.getTime() - now.getTime()) / 864e5) : null,
        daysSinceExpiry: status === 'expired' ? Math.floor((now.getTime() - validTo.getTime()) / 864e5) : null,
        status,
      };
    });

    const stats = { total: items.length, pending: 0, active: 0, expiring_soon: 0, scheduled: 0, expired: 0, rejected: 0 };
    for (const i of items) stats[i.status] += 1;
    const counterparties = new Set(items.map((i) => i.counterpartyName)).size;

    const { search = '', status = '' } = req.query;
    const s = search.trim().toLowerCase();
    if (s) {
      items = items.filter((i) => (i.counterpartyName || '').toLowerCase().includes(s) || (i.authCode || '').toLowerCase().includes(s)
        || i.products.some((p) => (p.name || '').toLowerCase().includes(s)));
    }
    if (status) items = items.filter((i) => i.status === status);

    // Things needing action first: pending, then expiring soon, then the rest.
    const rank = { pending: 0, expiring_soon: 1, active: 2, scheduled: 3, expired: 4, rejected: 5 };
    items.sort((a, b) => (rank[a.status] - rank[b.status]) || (new Date(b.requestedAt) - new Date(a.requestedAt)));

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    res.json({ success: true, side, data: items.slice((page - 1) * limit, page * limit), total: items.length, stats: { ...stats, counterparties } });
  } catch (err) {
    console.error('listTracker error:', err);
    res.status(500).json({ success: false, message: 'Failed to load authorization tracker' });
  }
};

const AUTH_STATUS = { pending: 'Pending', active: 'Active', expiring_soon: 'Expiring soon', scheduled: 'Scheduled', expired: 'Expired', rejected: 'Rejected' };

// @route GET /api/dealer-requests/tracker/export?mode=all|filtered&search=&status=
exports.exportTracker = require('../utils/trackerExport').safeHandler('authorization tracker', async (req, res) => {
  const { collectRows: collect, sendWorkbook: send } = require('../utils/trackerExport');
  const { rows, mode, applied, meta } = await collect(exports.listTracker, req, { clear: ['search', 'status'] });
  const counterpartyHeader = meta && meta.side === 'reseller' ? 'OEM' : 'Reseller';
  await send(res, {
    title: 'Authorization Tracker', rows, mode, applied,
    columns: [
      { header: 'Authorization Code', key: 'authCode', width: 22 },
      { header: 'Reference No', key: 'refNo', width: 22 },
      { header: counterpartyHeader, key: 'counterpartyName', width: 30 },
      { header: `${counterpartyHeader} Email`, key: 'counterpartyEmail', width: 30 },
      { header: 'Products', get: (r) => (r.products || []).map((p) => p.name).join('; '), width: 40 },
      { header: 'Product Codes', get: (r) => (r.products || []).map((p) => p.code).filter(Boolean).join('; '), width: 24 },
      { header: 'Conditions', get: (r) => (r.products || []).flatMap((p) => p.conditions || []).join('; '), width: 40 },
      { header: 'Documents', get: (r) => (r.documents || []).map((d) => d.label || d.fileName).filter(Boolean).join('; '), width: 40 },
      { header: 'Reason', key: 'reason', width: 34 },
      { header: 'Requested On', key: 'requestedAt', width: 16, type: 'date' },
      { header: 'Valid From', key: 'validFrom', width: 14, type: 'date' },
      { header: 'Valid To', key: 'validTo', width: 14, type: 'date' },
      { header: 'Status', get: (r) => AUTH_STATUS[r.status] || r.status, width: 15 },
      { header: 'Days Pending', key: 'daysPending', width: 13, type: 'number' },
      { header: 'Days Left', key: 'daysLeft', width: 11, type: 'number' },
      { header: 'Days Since Expiry', key: 'daysSinceExpiry', width: 16, type: 'number' },
      { header: 'Decided On', key: 'decidedAt', width: 16, type: 'date' },
      { header: 'Rejection Remarks', key: 'rejectionRemarks', width: 34 },
    ],
  });
});

async function findAccessible(req) {
  const row = await DealerAuthRequest.findOne({ where: { id: req.params.id }, include: REQUEST_INCLUDE });
  if (!row) return null;
  if (row.fromUserId !== req.user.id && row.toUserId !== req.user.id) return undefined; // exists but not yours
  return row;
}

// @route GET /api/dealer-requests/:id
exports.getRequest = async (req, res) => {
  try {
    const row = await findAccessible(req);
    if (row === null) return res.status(404).json({ success: false, message: 'Request not found' });
    if (row === undefined) return res.status(403).json({ success: false, message: 'Not authorized to view this request' });
    const [decorated] = await decorate([row]);
    res.json({ success: true, data: decorated });
  } catch (err) {
    console.error('getRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to load request' });
  }
};

// @route GET /api/dealer-requests/:id/reseller-profile
// Full bio-data view for the OEM reviewing a request — only the OEM the
// request was addressed to can see it, and only ever for the reseller on
// that specific request (not an open "look up anyone" endpoint).
exports.getResellerProfile = async (req, res) => {
  try {
    const request = await DealerAuthRequest.findOne({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.toUserId !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized' });

    const [user, profile] = await Promise.all([
      User.findOne({ where: { id: request.fromUserId }, attributes: ['id', 'name', 'email', 'partnerType'] }),
      PartnerProfile.findOne({
        where: { userId: request.fromUserId },
        include: [
          { model: PartnerContact, as: 'contacts' },
          { model: PartnerCertificate, as: 'certificates' },
          { model: PartnerTaxRegistration, as: 'taxRegistrations' },
        ],
      }),
    ]);

    res.json({ success: true, data: { user, profile } });
  } catch (err) {
    console.error('getResellerProfile error:', err);
    res.status(500).json({ success: false, message: 'Failed to load reseller profile' });
  }
};

// @route POST /api/dealer-requests/:id/approve
exports.approveRequest = async (req, res) => {
  try {
    const request = await DealerAuthRequest.findOne({
      where: { id: req.params.id, toUserId: req.user.id },
      include: [{
        model: DealerAuthRequestItem, as: 'items',
        include: [{ model: ProductMasterItem, as: 'product' }, { model: CompanyCategory, as: 'category' }],
      }],
    });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ success: false, message: 'This request has already been decided' });

    request.status = 'approved';
    request.decidedAt = new Date();
    await request.save();

    const [toProfile, fromProfile, fromUser] = await Promise.all([
      PartnerProfile.findOne({ where: { userId: req.user.id } }),
      PartnerProfile.findOne({ where: { userId: request.fromUserId } }),
      User.findByPk(request.fromUserId, { attributes: ['id', 'name', 'email'] }),
    ]);
    const oemName = companyLabel(toProfile) || req.user.name || 'The OEM';
    const resellerName = companyLabel(fromProfile) || fromUser?.name || 'The Reseller';

    // Push straight into the reseller's Our Products list — an approved
    // authorization IS a product they're now cleared to sell, so they
    // shouldn't have to re-enter it by hand (see ResellerProduct.js). One
    // row per item now that a request can cover multiple products.
    for (const item of request.items || []) {
      await ResellerProduct.findOrCreate({
        where: { dealerAuthRequestItemId: item.id },
        defaults: {
          userId: request.fromUserId,
          dealerAuthRequestId: request.id,
          dealerAuthRequestItemId: item.id,
          authSerialNo: request.authCode || request.refNo,
          productName: item.product?.name || item.customProductName || 'Authorized Product',
          decode: item.productCode || null,
          technicalSpecification: (item.conditionBullets || []).join('\n'),
          oemBy: oemName,
          validFrom: request.validFrom,
          validTo: request.validTo,
        },
      });
    }

    await notify(request.fromUserId, {
      type: 'auth_approved',
      title: 'Authorization Request Approved',
      message: `${oemName} approved your request (${request.authCode || request.refNo}) — added to Our Products.`,
      relatedType: 'DealerAuthRequest', relatedId: request.id,
    });

    // Dealer Authorization Letter — generated on the OEM's own division
    // letterhead (Endo/Diagnostics), covering the tender (if any), every
    // product and its conditions, then attached to the request AND emailed
    // straight to the reseller's own Master Admin, their Zonal Manager (if
    // one exists), and the reseller's own contact email — the approving
    // OEM login (Master Admin or Zonal Manager) doesn't have to do this by
    // hand. Best-effort: failures here must not undo the approval already
    // committed above.
    try {
      const division = inferDivision(request.items);
      const html = buildLetterHtml(request, request.items, resellerName, oemName, division);
      const buf = await renderPdf(html, `Dealer Authorization Letter - ${request.authCode || request.refNo}`, division);

      const uploadDir = process.env.UPLOAD_DIR || 'uploads';
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filename = `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
      fs.writeFileSync(path.join(uploadDir, filename), buf);

      await DealerAuthRequestDocument.create({
        dealerAuthRequestId: request.id,
        docType: 'other',
        label: 'Dealer Authorization Letter',
        fileUrl: `/uploads/${filename}`,
        fileName: `Dealer_Authorization_Letter_${(request.authCode || request.refNo).replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
        fileSize: buf.length,
      });

      if (isMailConfigured()) {
        const [primaryContact, zonalManager] = await Promise.all([
          fromProfile ? PartnerContact.findOne({ where: { profileId: fromProfile.id, isPrimary: true } }) : null,
          fromProfile ? StaffUser.findOne({ where: { partnerProfileId: fromProfile.id, role: 'zonal_manager', status: 'active' } }) : null,
        ]);
        const to = primaryContact?.email || fromUser?.email;
        const cc = [fromUser?.email, zonalManager?.email].filter((e) => e && e !== to);
        if (to) {
          await sendMail({
            to, cc: cc.length ? cc : undefined,
            subject: `Dealer Authorization Letter — ${AUTH_TYPE_LABELS[request.authType] || 'Authorization'} (${request.authCode || request.refNo})`,
            text: `Your authorization request (${request.authCode || request.refNo}) has been approved by ${oemName}. The Dealer Authorization Letter is attached.`,
            attachments: [{ filename: `Dealer_Authorization_Letter_${(request.authCode || request.refNo).replace(/[^a-zA-Z0-9]/g, '_')}.pdf`, content: buf }],
          });
        }
      }
    } catch (letterErr) {
      console.error('approveRequest: letter generation/email failed (non-fatal):', letterErr.message);
    }

    res.json({ success: true, data: request.toJSON() });
  } catch (err) {
    console.error('approveRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to approve request' });
  }
};

// @route POST /api/dealer-requests/:id/reject   { remarks }
exports.rejectRequest = async (req, res) => {
  try {
    const { remarks } = req.body;
    if (!remarks?.trim()) return res.status(400).json({ success: false, message: 'A reason is required to reject a request' });

    const request = await DealerAuthRequest.findOne({ where: { id: req.params.id, toUserId: req.user.id } });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ success: false, message: 'This request has already been decided' });

    request.status = 'rejected';
    request.rejectionRemarks = remarks.trim();
    request.decidedAt = new Date();
    await request.save();

    const toProfile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
    await notify(request.fromUserId, {
      type: 'auth_rejected',
      title: 'Authorization Request Rejected',
      message: `${companyLabel(toProfile) || req.user.name || 'The OEM'} rejected your request (${request.authCode || request.refNo}): ${remarks.trim()}`,
      relatedType: 'DealerAuthRequest', relatedId: request.id,
    });

    res.json({ success: true, data: request.toJSON() });
  } catch (err) {
    console.error('rejectRequest error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject request' });
  }
};
