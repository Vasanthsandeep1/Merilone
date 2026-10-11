const fs = require('fs');
const PDFDocument = require('pdfkit');
const { Op, literal } = require('sequelize');
const { Quotation, Client, PartnerProfile, PaymentAllocation, PaymentReceipt } = require('../models');
const { applyAdvancesToInvoice, paidByInvoice, advancesBySalesOrder } = require('../utils/advances');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sales & Invoices > Quotations. A quotation is either built in-app
// ("Create New Quotation" wizard, source='created') — in which case we
// recompute totals from the submitted line items server-side rather than
// trusting client-sent totals — or it's a file the partner already had and
// just wants tracked ("Upload Quotation", source='uploaded'), which carries
// no fabricated line items at all; its own PDF/doc is served as-is.

function toPublicPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.indexOf('uploads/');
  return idx === -1 ? `/${normalized}` : `/${normalized.slice(idx)}`;
}

function toDiskPath(publicPath) {
  return publicPath ? publicPath.replace(/^\//, '') : null;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Recomputes amount/cgst/sgst/total per line and the document totals from
// scratch — the frontend sends rate/qty/gstRate per line, everything else
// is derived here so a tampered or stale client-side total can't persist.
function computeTotals(items, discount, additionalCharges) {
  const lines = (items || []).map((it) => {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const gstRate = Number(it.gstRate) || 0;
    const amount = round2(qty * rate);
    const gstAmount = round2((amount * gstRate) / 100);
    const cgst = round2(gstAmount / 2);
    const sgst = round2(gstAmount - cgst);
    const total = round2(amount + cgst + sgst);
    return { ...it, qty, rate, gstRate, amount, cgst, sgst, total };
  });

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const cgstTotal = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const sgstTotal = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const totalQuantity = round2(lines.reduce((s, l) => s + l.qty, 0));

  let discountAmount = 0;
  if (discount && Number(discount.value) > 0) {
    discountAmount = discount.type === 'percent' ? round2((subtotal * Number(discount.value)) / 100) : round2(Number(discount.value));
  }
  const chargesTotal = round2((additionalCharges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0));

  const grandTotal = round2(subtotal + cgstTotal + sgstTotal - discountAmount + chargesTotal);

  return { lines, subtotal, cgstTotal, sgstTotal, totalQuantity, grandTotal, discountAmount };
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function numToWords(n) {
  n = Math.floor(n);
  if (n === 0) return 'Zero';
  const chunk = (num) => {
    let s = '';
    if (num >= 100) { s += `${ONES[Math.floor(num / 100)]} Hundred `; num %= 100; }
    if (num >= 20) { s += `${TENS[Math.floor(num / 10)]} `; num %= 10; }
    if (num > 0) s += `${ONES[num]} `;
    return s.trim();
  };
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${chunk(crore)} Crore`);
  if (lakh) parts.push(`${chunk(lakh)} Lakh`);
  if (thousand) parts.push(`${chunk(thousand)} Thousand`);
  if (n) parts.push(chunk(n));
  return parts.join(' ') || 'Zero';
}
function totalInWords(amount, currency) {
  const whole = Math.floor(amount);
  const paise = Math.round((amount - whole) * 100);
  const currencyName = currency === 'INR' ? 'Rupees' : currency;
  let words = `${numToWords(whole)} ${currencyName}`;
  if (paise > 0) words += ` and ${numToWords(paise)} Paise`;
  return `${words} Only`;
}

// Quotations and Proforma Invoices are the same table (see Quotation.js)
// but are numbered as fully separate sequences — a Proforma Invoice never
// borrows a quotation number or vice versa.
const DOC_PREFIX = { quotation: 'A', invoice: 'INV', proforma: 'PI', sales_order: 'SO', delivery_challan: 'DC', credit_note: 'CN' };
const DOC_TITLE = { quotation: 'Quotation', invoice: 'Invoice', proforma: 'Proforma Invoice', sales_order: 'Sales Order', delivery_challan: 'Delivery Challan', credit_note: 'Credit Note' };
const DOC_FROM_LABEL = { quotation: 'Quotation From', invoice: 'Billed By', proforma: 'Proforma Invoice From', sales_order: 'Sales Order From', delivery_challan: 'Delivered By', credit_note: 'Issued By' };
const DOC_TO_LABEL = { quotation: 'Quotation For', invoice: 'Billed To', proforma: 'Proforma Invoice For', sales_order: 'Sales Order For', delivery_challan: 'Delivered To', credit_note: 'Issued To' };
// Label for the second date (validTillDate) and the customer PO line, per doc.
const DOC_DUE_LABEL = { quotation: 'Valid Till', invoice: 'Due Date', proforma: 'Valid Till', sales_order: 'Delivery Date', delivery_challan: 'Delivery Date', credit_note: 'Valid Till' };
// The sales chain: which document type each one is raised from.
// The sales chain: which document each type is raised from. The new
// document copies the client, items, prices, shipping and (from a Sales
// Order) the customer's PO, so nothing is typed twice.
const SOURCE_DOC_TYPE = { sales_order: 'quotation', proforma: 'quotation', invoice: 'sales_order', delivery_challan: 'sales_order' };
// The follow-on document shown on each row (Quotation -> SO -> Invoice).
const NEXT_DOC_TYPE = { quotation: 'sales_order', sales_order: 'invoice' };
const VALID_DOC_TYPES = ['quotation', 'invoice', 'proforma', 'sales_order', 'delivery_challan', 'credit_note'];
function normalizeDocType(v) {
  return VALID_DOC_TYPES.includes(v) ? v : 'quotation';
}
// Next number = highest existing number for this doc type + 1. (Counting
// rows instead would re-issue an existing number once any document is
// deleted — e.g. delete SO00001 while SO00002 exists -> SO00002 again.)
async function nextQuotationNo(userId, docType) {
  const prefix = DOC_PREFIX[docType];
  const rows = await Quotation.findAll({ where: { userId, docType }, attributes: ['quotationNo'], raw: true });
  const max = rows.reduce((m, r) => {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(r.quotationNo || '');
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

// @route GET /api/quotations/next-number?docType=quotation|proforma
exports.getNextNumber = async (req, res) => {
  try {
    const docType = normalizeDocType(req.query.docType);
    res.json({ success: true, quotationNo: await nextQuotationNo(req.user.id, docType) });
  } catch (err) {
    console.error('getNextNumber error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate quotation number' });
  }
};

// @route GET /api/quotations?docType=quotation|proforma
exports.listQuotations = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const { search, status, clientId, dateFrom, dateTo, readyFor } = req.query;

    const where = { userId: req.user.id, docType: normalizeDocType(req.query.docType) };
    if (status) where.status = status;
    if (clientId) where.clientId = clientId;
    // ?readyFor=<docType> — documents that type can be raised from: built
    // in-app, not rejected, and without one of that type yet (e.g. quotations
    // with no Sales Order). Emailing isn't required first.
    if (SOURCE_DOC_TYPE[readyFor]) {
      where.docType = SOURCE_DOC_TYPE[readyFor];
      where.source = 'created';
      where.status = { [Op.ne]: 'Rejected' };
      where[Op.and] = [literal(`NOT EXISTS (SELECT 1 FROM quotations nd WHERE nd.source_quotation_id = \`Quotation\`.id AND nd.doc_type = ${Quotation.sequelize.escape(readyFor)})`)];
    }
    if (dateFrom || dateTo) {
      where.quotationDate = {};
      if (dateFrom) where.quotationDate[Op.gte] = dateFrom;
      if (dateTo) where.quotationDate[Op.lte] = dateTo;
    }
    if (search) {
      where[Op.or] = [
        { quotationNo: { [Op.like]: `%${search}%` } },
        { poNumber: { [Op.like]: `%${search}%` } },
        { '$client.business_name$': { [Op.like]: `%${search}%` } },
      ];
    }

    const { rows, count } = await Quotation.findAndCountAll({
      where,
      include: [
        { model: Client, as: 'client', attributes: ['id', 'businessName', 'logoPath'] },
        { model: Quotation, as: 'sourceQuotation', attributes: ['id', 'quotationNo', 'docType'] },
        { model: Quotation, as: 'nextDocument', attributes: ['id', 'quotationNo', 'docType'], required: false, where: { docType: NEXT_DOC_TYPE[where.docType] || '__none__' } },
      ],
      order: [['createdAt', 'DESC']],
      subQuery: false,
      distinct: true,
      limit,
      offset,
    });

    // Payment position: how much of each invoice is paid, and how much
    // advance each Sales Order has received (see utils/advances.js).
    const data = rows.map((r) => r.toJSON());
    const ids = data.map((r) => r.id);
    if (where.docType === 'invoice') {
      const paid = await paidByInvoice(ids);
      for (const r of data) r.paidAmount = paid[r.id] || 0;
    }
    if (where.docType === 'sales_order') {
      const adv = await advancesBySalesOrder(ids);
      for (const r of data) r.advanceReceived = adv[r.id] || 0;
    }
    res.json({ success: true, data, total: count, page, limit, totalPages: Math.max(1, Math.ceil(count / limit)) });
  } catch (err) {
    console.error('listQuotations error:', err);
    res.status(500).json({ success: false, message: 'Failed to load quotations' });
  }
};

// @route GET /api/quotations/:id
exports.getQuotation = async (req, res) => {
  try {
    const q = await Quotation.findOne({ where: { id: req.params.id, userId: req.user.id }, include: [{ model: Client, as: 'client' }, { model: Quotation, as: 'linkedInvoice', attributes: ['id', 'quotationNo', 'grandTotal'] }, { model: Quotation, as: 'sourceQuotation', attributes: ['id', 'quotationNo', 'docType'] }] });
    if (!q) return res.status(404).json({ success: false, message: 'Quotation not found' });
    res.json({ success: true, data: q.toJSON() });
  } catch (err) {
    console.error('getQuotation error:', err);
    res.status(500).json({ success: false, message: 'Failed to load quotation' });
  }
};

function parseJsonField(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// @route POST /api/quotations   (multipart, optional field "logo")
exports.createQuotation = async (req, res) => {
  try {
    const body = req.body;
    const items = parseJsonField(body.items) || [];
    const discount = parseJsonField(body.discount);
    const additionalCharges = parseJsonField(body.additionalCharges) || [];
    const { lines, subtotal, cgstTotal, sgstTotal, totalQuantity, grandTotal } = computeTotals(items, discount, additionalCharges);

    const docType = normalizeDocType(body.docType);
    if (docType === 'credit_note' && !body.reason) {
      return res.status(400).json({ success: false, message: 'A reason is required to issue a credit note' });
    }
    // A Sales Order confirms a customer's PO: it must carry the PO number and
    // the delivery date we're committing to.
    if (docType === 'sales_order') {
      if (!body.poNumber) return res.status(400).json({ success: false, message: "Enter the customer's PO number" });
      if (!body.validTillDate) return res.status(400).json({ success: false, message: 'Enter the delivery date' });
      if (body.validTillDate < body.quotationDate) return res.status(400).json({ success: false, message: "Delivery date can't be before the sales order date" });
    }
    let sourceQuotation = null;
    if (body.sourceQuotationId) {
      const sourceType = SOURCE_DOC_TYPE[docType];
      if (!sourceType) return res.status(400).json({ success: false, message: `A ${DOC_TITLE[docType]} can't be raised from another document` });
      sourceQuotation = await Quotation.findOne({ where: { id: body.sourceQuotationId, userId: req.user.id, docType: sourceType } });
      if (!sourceQuotation) return res.status(400).json({ success: false, message: `Source ${DOC_TITLE[sourceType].toLowerCase()} not found` });
      const existing = await Quotation.findOne({ where: { sourceQuotationId: sourceQuotation.id, userId: req.user.id, docType }, attributes: ['quotationNo'] });
      if (existing) return res.status(400).json({ success: false, message: `${DOC_TITLE[sourceType]} ${sourceQuotation.quotationNo} already has ${DOC_TITLE[docType]} ${existing.quotationNo}` });
    }

    const payload = {
      userId: req.user.id,
      docType,
      source: 'created',
      quotationNo: body.quotationNo || await nextQuotationNo(req.user.id, docType),
      poNumber: body.poNumber || null,
      poDate: body.poDate || null,
      sourceQuotationId: sourceQuotation ? sourceQuotation.id : null,
      title: body.title || DOC_TITLE[docType],
      subtitle: body.subtitle || null,
      quotationDate: body.quotationDate,
      validTillDate: body.validTillDate || null,
      clientId: body.clientId || null,
      linkedInvoiceId: body.linkedInvoiceId || null,
      reason: body.reason || null,
      currency: body.currency || 'INR',
      shippingEnabled: body.shippingEnabled === 'true' || body.shippingEnabled === true,
      shippingFrom: parseJsonField(body.shippingFrom),
      shippingTo: parseJsonField(body.shippingTo),
      items: lines,
      discount,
      additionalCharges,
      subtotal,
      cgstTotal,
      sgstTotal,
      grandTotal,
      totalQuantity,
      notes: body.notes || null,
      terms: body.terms || null,
      accentColor: body.accentColor || '#1E4373',
      // Every new document starts as Generated (stored 'Draft'); it becomes
      // Sent only when emailed via emailQuotation.
      status: 'Draft',
    };
    if (req.file) payload.logoPath = toPublicPath(req.file.path);

    const quotation = await Quotation.create(payload);
    // An invoice raised from a Sales Order picks up any advance the customer
    // already paid against that order.
    if (docType === 'invoice' && sourceQuotation) await applyAdvancesToInvoice(quotation, sourceQuotation.id);
    // Receiving the customer's PO means they accepted the quotation.
    if (docType === 'sales_order' && sourceQuotation && sourceQuotation.status !== 'Accepted') {
      sourceQuotation.status = 'Accepted';
      await sourceQuotation.save();
    }
    res.json({ success: true, data: quotation.toJSON() });
  } catch (err) {
    console.error('createQuotation error:', err);
    res.status(500).json({ success: false, message: 'Failed to create quotation' });
  }
};

// @route PATCH /api/quotations/:id   (multipart, optional field "logo")
exports.updateQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found' });
    if (quotation.source !== 'created') return res.status(400).json({ success: false, message: 'Uploaded quotations cannot be edited — delete and re-upload instead' });

    const body = req.body;
    const items = body.items !== undefined ? (parseJsonField(body.items) || []) : quotation.items;
    const discount = body.discount !== undefined ? parseJsonField(body.discount) : quotation.discount;
    const additionalCharges = body.additionalCharges !== undefined ? (parseJsonField(body.additionalCharges) || []) : quotation.additionalCharges;
    const { lines, subtotal, cgstTotal, sgstTotal, totalQuantity, grandTotal } = computeTotals(items, discount, additionalCharges);

    if (quotation.docType === 'credit_note' && body.reason !== undefined && !body.reason) {
      return res.status(400).json({ success: false, message: 'A reason is required to issue a credit note' });
    }

    const FIELDS = ['poNumber', 'poDate', 'title', 'subtitle', 'quotationDate', 'validTillDate', 'clientId', 'currency', 'notes', 'terms', 'accentColor', 'linkedInvoiceId', 'reason'];
    for (const f of FIELDS) if (body[f] !== undefined) quotation[f] = body[f] || null;
    if (quotation.docType === 'sales_order') {
      if (!quotation.poNumber) return res.status(400).json({ success: false, message: "Enter the customer's PO number" });
      if (!quotation.validTillDate) return res.status(400).json({ success: false, message: 'Enter the delivery date' });
      if (quotation.validTillDate < quotation.quotationDate) return res.status(400).json({ success: false, message: "Delivery date can't be before the sales order date" });
    }
    if (body.shippingEnabled !== undefined) quotation.shippingEnabled = body.shippingEnabled === 'true' || body.shippingEnabled === true;
    if (body.shippingFrom !== undefined) quotation.shippingFrom = parseJsonField(body.shippingFrom);
    if (body.shippingTo !== undefined) quotation.shippingTo = parseJsonField(body.shippingTo);
    quotation.items = lines;
    quotation.discount = discount;
    quotation.additionalCharges = additionalCharges;
    quotation.subtotal = subtotal;
    quotation.cgstTotal = cgstTotal;
    quotation.sgstTotal = sgstTotal;
    quotation.grandTotal = grandTotal;
    quotation.totalQuantity = totalQuantity;

    if (req.file) {
      const oldDisk = toDiskPath(quotation.logoPath);
      if (oldDisk && fs.existsSync(oldDisk)) fs.unlink(oldDisk, () => {});
      quotation.logoPath = toPublicPath(req.file.path);
    }

    await quotation.save();
    res.json({ success: true, data: quotation.toJSON() });
  } catch (err) {
    console.error('updateQuotation error:', err);
    res.status(500).json({ success: false, message: 'Failed to update quotation' });
  }
};

// @route PATCH /api/quotations/:id/status   { status }
exports.setStatus = async (req, res) => {
  try {
    const quotation = await Quotation.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found' });
    // 'Sent' is only ever set by a successful email (see emailQuotation), so
    // it always means the client actually received the document.
    if (!['Draft', 'Accepted', 'Rejected'].includes(req.body.status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    // Clearing the client's response goes back to Sent if it was emailed,
    // otherwise to Generated (stored as 'Draft').
    quotation.status = req.body.status === 'Draft' && quotation.sentAt ? 'Sent' : req.body.status;
    await quotation.save();
    res.json({ success: true, data: quotation.toJSON() });
  } catch (err) {
    console.error('setStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
};

// @route DELETE /api/quotations/:id
exports.deleteQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found' });
    const logoDisk = toDiskPath(quotation.logoPath);
    if (logoDisk && fs.existsSync(logoDisk)) fs.unlink(logoDisk, () => {});
    const fileDisk = toDiskPath(quotation.uploadedFilePath);
    if (fileDisk && fs.existsSync(fileDisk)) fs.unlink(fileDisk, () => {});
    await quotation.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deleteQuotation error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete quotation' });
  }
};

// @route POST /api/quotations/upload   (multipart, field "file")
exports.uploadQuotation = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const docType = normalizeDocType(req.body.docType);
    const quotation = await Quotation.create({
      userId: req.user.id,
      docType,
      source: 'uploaded',
      quotationNo: req.body.quotationNo || await nextQuotationNo(req.user.id, docType),
      poNumber: req.body.poNumber || null,
      quotationDate: req.body.quotationDate || new Date().toISOString().slice(0, 10),
      clientId: req.body.clientId || null,
      status: 'Draft',
      uploadedFilePath: toPublicPath(req.file.path),
      uploadedFileName: req.file.originalname,
    });
    res.json({ success: true, data: quotation.toJSON() });
  } catch (err) {
    console.error('uploadQuotation error:', err);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

// @route GET /api/quotations/:id/file — the raw file for an uploaded quotation
exports.downloadUploadedFile = async (req, res) => {
  try {
    const quotation = await Quotation.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!quotation || !quotation.uploadedFilePath) return res.status(404).json({ success: false, message: 'File not found' });
    const diskPath = toDiskPath(quotation.uploadedFilePath);
    if (!fs.existsSync(diskPath)) return res.status(404).json({ success: false, message: 'File not found' });
    res.download(diskPath, quotation.uploadedFileName || 'quotation');
  } catch (err) {
    console.error('downloadUploadedFile error:', err);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
};

function companyLabelAndAddress(profile) {
  const info = profile?.companyInfo || {};
  const addr = profile?.registeredAddress || {};
  const name = info.tradeName || info.legalName || info.shortName || '';
  const addressLine = [addr.line1, addr.line2, addr.city, addr.district, addr.state, addr.country, addr.pincode].filter(Boolean).join(', ');
  return { name, addressLine, gstin: info.gstin || '', pan: info.pan || '' };
}

// Draws the quotation onto an already-constructed (not yet .end()'d) pdfkit
// document — shared by downloadPdf (piped straight to the response) and
// emailQuotation (buffered in memory to attach to an outgoing email), so the
// two never drift into rendering different-looking PDFs.
function drawQuotationPdf(doc, quotation, from, client) {
    const currencySymbol = quotation.currency === 'INR' ? 'Rs.' : quotation.currency;

    doc.fontSize(20).fillColor('#060F1D').text(quotation.title || DOC_TITLE[quotation.docType] || 'Quotation', { align: 'center' });
    if (quotation.subtitle) doc.fontSize(10).fillColor('#6b7280').text(quotation.subtitle, { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(9).fillColor('#111827');
    const metaTop = doc.y;
    const docLabel = DOC_TITLE[quotation.docType] || 'Quotation';
    doc.text(`${docLabel} No: ${quotation.quotationNo}`, 40, metaTop);
    doc.text(`${docLabel} Date: ${quotation.quotationDate}`, 40);
    if (quotation.poNumber) doc.text(`Customer PO No: ${quotation.poNumber}${quotation.poDate ? `  dated ${quotation.poDate}` : ''}`, 40);
    if (quotation.sourceQuotation) doc.text(`Against ${DOC_TITLE[quotation.sourceQuotation.docType] || 'Quotation'}: ${quotation.sourceQuotation.quotationNo}`, 40);
    if (quotation.validTillDate) {
      if (quotation.docType === 'sales_order') doc.font('Helvetica-Bold');
      doc.text(`${DOC_DUE_LABEL[quotation.docType] || 'Valid Till'}: ${quotation.validTillDate}`, 40);
      doc.font('Helvetica');
    }
    doc.moveDown(1);

    const colWidth = 260;
    const leftX = 40;
    const rightX = 320;
    const blockTop = doc.y;

    doc.fontSize(10).fillColor('#1E4373').text(DOC_FROM_LABEL[quotation.docType] || 'Quotation From', leftX, blockTop, { width: colWidth });
    doc.fontSize(9).fillColor('#111827').text(from.name || '-', leftX, doc.y, { width: colWidth });
    if (from.addressLine) doc.fillColor('#4b5563').text(from.addressLine, { width: colWidth });
    if (from.gstin) doc.fillColor('#4b5563').text(`GSTIN: ${from.gstin}`, { width: colWidth });
    if (from.pan) doc.fillColor('#4b5563').text(`PAN: ${from.pan}`, { width: colWidth });

    doc.fontSize(10).fillColor('#1E4373').text(DOC_TO_LABEL[quotation.docType] || 'Quotation For', rightX, blockTop, { width: colWidth });
    doc.fontSize(9).fillColor('#111827').text(client?.businessName || '-', rightX, doc.y, { width: colWidth });
    const clientAddr = client ? [client.streetAddress, client.city, client.state, client.country, client.postalCode].filter(Boolean).join(', ') : '';
    if (clientAddr) doc.fillColor('#4b5563').text(clientAddr, rightX, doc.y, { width: colWidth });
    if (client?.gstin) doc.fillColor('#4b5563').text(`GSTIN: ${client.gstin}`, rightX, doc.y, { width: colWidth });
    if (client?.pan) doc.fillColor('#4b5563').text(`PAN: ${client.pan}`, rightX, doc.y, { width: colWidth });

    doc.moveDown(2);

    const items = quotation.items || [];
    const tableTop = doc.y;
    const cols = [
      { key: 'name', label: 'Item', width: 140 },
      { key: 'hsn', label: 'HSN/SAC', width: 55 },
      { key: 'gstRate', label: 'GST%', width: 40 },
      { key: 'qty', label: 'Qty', width: 40 },
      { key: 'rate', label: 'Rate', width: 55 },
      { key: 'amount', label: 'Amount', width: 60 },
      { key: 'total', label: 'Total', width: 65 },
    ];
    let x = 40;
    doc.rect(40, tableTop, 515, 20).fill('#1E4373');
    doc.fillColor('#ffffff').fontSize(8);
    for (const c of cols) { doc.text(c.label, x + 4, tableTop + 6, { width: c.width - 8 }); x += c.width; }

    let y = tableTop + 20;
    doc.fillColor('#111827').fontSize(8);
    items.forEach((it, idx) => {
      const rowH = 18;
      if (idx % 2 === 1) doc.rect(40, y, 515, rowH).fill('#f9fafb').fillColor('#111827');
      x = 40;
      const vals = { name: it.name || '', hsn: it.hsn || '-', gstRate: `${it.gstRate || 0}%`, qty: it.qty, rate: `${currencySymbol} ${it.rate}`, amount: `${currencySymbol} ${it.amount}`, total: `${currencySymbol} ${it.total}` };
      for (const c of cols) { doc.text(String(vals[c.key] ?? ''), x + 4, y + 5, { width: c.width - 8 }); x += c.width; }
      y += rowH;
    });
    doc.rect(40, tableTop, 515, y - tableTop).strokeColor('#e5e7eb').stroke();

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#111827');
    const totalsX = 350;
    doc.text(`Subtotal: ${currencySymbol} ${quotation.subtotal}`, totalsX, doc.y, { width: 200, align: 'right' });
    doc.text(`CGST: ${currencySymbol} ${quotation.cgstTotal}`, totalsX, doc.y, { width: 200, align: 'right' });
    doc.text(`SGST: ${currencySymbol} ${quotation.sgstTotal}`, totalsX, doc.y, { width: 200, align: 'right' });
    if (quotation.discount?.value) doc.text(`Discount: -${currencySymbol} ${quotation.discount.amount || 0}`, totalsX, doc.y, { width: 200, align: 'right' });
    doc.fontSize(11).fillColor('#1E4373').text(`Grand Total: ${currencySymbol} ${quotation.grandTotal}`, totalsX, doc.y, { width: 200, align: 'right' });

    // Invoices: payments already received against it (advance applied at
    // creation, or later receipts) and what's still due.
    const received = (quotation.payments || []).reduce((s, p) => s + p.amount, 0);
    if (quotation.docType === 'invoice' && received > 0) {
      doc.fontSize(9).fillColor('#111827');
      for (const p of quotation.payments) {
        doc.text(`Less: ${p.type === 'advance' ? 'Advance' : 'Payment'} received (${p.receiptNo}, ${p.date}): ${currencySymbol} ${p.amount.toFixed(2)}`, totalsX - 120, doc.y, { width: 320, align: 'right' });
      }
      const due = Math.max(0, Math.round((Number(quotation.grandTotal) - received) * 100) / 100);
      doc.fontSize(11).fillColor(due > 0 ? '#b91c1c' : '#15803d').text(due > 0 ? `Balance Due: ${currencySymbol} ${due.toFixed(2)}` : 'Fully Paid', totalsX, doc.y, { width: 200, align: 'right' });
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor('#6b7280').text(`Amount in words: ${totalInWords(Number(quotation.grandTotal), quotation.currency)}`, 40);

    if (quotation.terms) { doc.moveDown(1); doc.fontSize(9).fillColor('#111827').text('Terms & Conditions', 40, doc.y); doc.fontSize(8).fillColor('#4b5563').text(quotation.terms, 40); }
    if (quotation.notes) { doc.moveDown(1); doc.fontSize(9).fillColor('#111827').text('Notes', 40, doc.y); doc.fontSize(8).fillColor('#4b5563').text(quotation.notes, 40); }
}

async function loadPdfInputs(req) {
  const quotation = await Quotation.findOne({ where: { id: req.params.id, userId: req.user.id }, include: [{ model: Client, as: 'client' }, { model: Quotation, as: 'sourceQuotation', attributes: ['id', 'quotationNo', 'docType'] }] });
  if (!quotation) return null;
  const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
  const from = companyLabelAndAddress(profile);
  if (quotation.docType === 'invoice') {
    const allocs = await PaymentAllocation.findAll({
      where: { invoiceId: quotation.id },
      include: [{ model: PaymentReceipt, as: 'paymentReceipt', attributes: ['receiptNo', 'receiptDate', 'paymentType'] }],
      order: [['createdAt', 'ASC']],
    });
    quotation.payments = allocs.map((a) => ({
      amount: Number(a.amount), receiptNo: a.paymentReceipt?.receiptNo, date: a.paymentReceipt?.receiptDate, type: a.paymentReceipt?.paymentType,
    }));
  }
  return { quotation, from, client: quotation.client };
}

function bufferPdf(quotation, from, client) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawQuotationPdf(doc, quotation, from, client);
    doc.end();
  });
}

// @route GET /api/quotations/:id/pdf — generates a real PDF for a
// source='created' quotation from its stored data (not a fabricated
// preview — every number on it is what computeTotals() derived and saved).
exports.downloadPdf = async (req, res) => {
  try {
    const found = await loadPdfInputs(req);
    if (!found) return res.status(404).json({ success: false, message: 'Quotation not found' });
    const { quotation, from, client } = found;
    if (quotation.source === 'uploaded') return exports.downloadUploadedFile(req, res);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${quotation.quotationNo}.pdf"`);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);
    drawQuotationPdf(doc, quotation, from, client);
    doc.end();
  } catch (err) {
    console.error('downloadPdf error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to generate PDF' });
  }
};

// @route POST /api/quotations/:id/email — emails the quotation PDF to its
// linked client's email address. Requires a client with an email on file;
// uploaded quotations are emailed as their original file instead of a
// regenerated PDF.
exports.emailQuotation = async (req, res) => {
  try {
    const found = await loadPdfInputs(req);
    if (!found) return res.status(404).json({ success: false, message: 'Quotation not found' });
    const { quotation, from, client } = found;
    const docTitle = DOC_TITLE[quotation.docType] || 'Quotation';

    // Recipients come from the Send form (pre-filled with the client's email
    // but editable); fall back to the client's email for older callers.
    const parseList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((e) => e.trim()).filter(Boolean);
    const to = parseList(req.body?.to);
    if (!to.length && client?.email) to.push(client.email);
    const cc = parseList(req.body?.cc);
    if (!to.length) return res.status(400).json({ success: false, message: 'Enter an email address to send to.' });
    const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e));
    if (bad) return res.status(400).json({ success: false, message: `"${bad}" isn't a valid email address.` });

    const { sendMail, isMailConfigured } = require('../utils/mailer');
    if (!isMailConfigured()) return res.status(503).json({ success: false, message: 'Email sending is not configured on this server. Add the EMAIL_* settings to backend/.env.' });

    let attachment;
    if (quotation.source === 'uploaded') {
      const diskPath = toDiskPath(quotation.uploadedFilePath);
      if (!diskPath || !fs.existsSync(diskPath)) return res.status(404).json({ success: false, message: 'Uploaded file not found' });
      attachment = { filename: quotation.uploadedFileName || `${quotation.quotationNo}`, path: diskPath };
    } else {
      const buffer = await bufferPdf(quotation, from, client);
      attachment = { filename: `${quotation.quotationNo}.pdf`, content: buffer, contentType: 'application/pdf' };
    }

    const subject = (req.body?.subject || '').trim() || `${docTitle} ${quotation.quotationNo} from ${from.name || 'us'}`;
    const text = (req.body?.message || '').trim()
      || `Dear ${client?.businessName || 'Sir/Madam'},

Please find attached ${docTitle.toLowerCase()} ${quotation.quotationNo}${quotation.source === 'created' ? ` for ${quotation.currency} ${quotation.grandTotal}` : ''}.

Regards,
${from.name || ''}`;

    await sendMail({ to: to.join(', '), cc: cc.length ? cc.join(', ') : undefined, subject, text, attachments: [attachment] });

    // Delivered — record it. A document the client already accepted or
    // rejected keeps that status; a re-send only updates when/to whom.
    quotation.sentAt = new Date();
    quotation.sentTo = [...to, ...cc].join(', ').slice(0, 500);
    if (quotation.status === 'Draft') quotation.status = 'Sent';
    await quotation.save();

    res.json({ success: true, data: { status: quotation.status, sentAt: quotation.sentAt, sentTo: quotation.sentTo } });
  } catch (err) {
    console.error('emailQuotation error:', err);
    res.status(500).json({ success: false, message: `Failed to send email${err?.response ? `: ${err.response}` : ''}` });
  }
};

// @route GET /api/quotations/stats — small counters for the list page's
// "Total Quotations" / "Draft Quotations" cards.
exports.getStats = async (req, res) => {
  try {
    const docType = normalizeDocType(req.query.docType);
    const [total, draft] = await Promise.all([
      Quotation.count({ where: { userId: req.user.id, docType } }),
      Quotation.count({ where: { userId: req.user.id, docType, status: 'Draft' } }),
    ]);
    res.json({ success: true, total, draft });
  } catch (err) {
    console.error('getStats error:', err);
    res.status(500).json({ success: false, message: 'Failed to load stats' });
  }
};

// Shared with paymentReceiptController (receipt PDF + email).
exports.pdfHelpers = { companyLabelAndAddress, totalInWords, EMAIL_RE };
