const fs = require('fs');
const PDFDocument = require('pdfkit');
const { Op } = require('sequelize');
const { Purchase, Vendor, PartnerProfile } = require('../models');

// Purchases > Purchases Hub. Mirrors quotationController's shape (see that
// file for the reasoning behind server-side total recomputation and the
// created/uploaded split) but the counterparty is a Vendor, and the roles
// are reversed on the document: "Billed To" is the partner's own details,
// "Billed By" is the vendor's.

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

function nextPurchaseNo(count) {
  return `A${String(count + 1).padStart(5, '0')}`;
}

// @route GET /api/purchases/next-number
exports.getNextNumber = async (req, res) => {
  try {
    const count = await Purchase.count({ where: { userId: req.user.id } });
    res.json({ success: true, purchaseNo: nextPurchaseNo(count) });
  } catch (err) {
    console.error('getNextNumber error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate purchase number' });
  }
};

// @route GET /api/purchases
exports.listPurchases = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const { search, status, vendorId, dateFrom, dateTo } = req.query;

    const where = { userId: req.user.id };
    if (status) where.status = status;
    if (vendorId) where.vendorId = vendorId;
    if (dateFrom || dateTo) {
      where.purchaseDate = {};
      if (dateFrom) where.purchaseDate[Op.gte] = dateFrom;
      if (dateTo) where.purchaseDate[Op.lte] = dateTo;
    }
    if (search) {
      where[Op.or] = [
        { purchaseNo: { [Op.like]: `%${search}%` } },
        { invoiceNo: { [Op.like]: `%${search}%` } },
        { poNumber: { [Op.like]: `%${search}%` } },
      ];
    }

    const { rows, count } = await Purchase.findAndCountAll({
      where,
      include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'logoPath'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    res.json({ success: true, data: rows.map((r) => r.toJSON()), total: count, page, limit, totalPages: Math.max(1, Math.ceil(count / limit)) });
  } catch (err) {
    console.error('listPurchases error:', err);
    res.status(500).json({ success: false, message: 'Failed to load purchases' });
  }
};

// @route GET /api/purchases/stats
exports.getStats = async (req, res) => {
  try {
    const [total, draft] = await Promise.all([
      Purchase.count({ where: { userId: req.user.id } }),
      Purchase.count({ where: { userId: req.user.id, status: 'Draft' } }),
    ]);
    res.json({ success: true, total, draft });
  } catch (err) {
    console.error('getStats error:', err);
    res.status(500).json({ success: false, message: 'Failed to load stats' });
  }
};

// @route GET /api/purchases/:id
exports.getPurchase = async (req, res) => {
  try {
    const p = await Purchase.findOne({ where: { id: req.params.id, userId: req.user.id }, include: [{ model: Vendor, as: 'vendor' }] });
    if (!p) return res.status(404).json({ success: false, message: 'Purchase not found' });
    res.json({ success: true, data: p.toJSON() });
  } catch (err) {
    console.error('getPurchase error:', err);
    res.status(500).json({ success: false, message: 'Failed to load purchase' });
  }
};

function parseJsonField(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// @route POST /api/purchases   (multipart, optional field "logo")
exports.createPurchase = async (req, res) => {
  try {
    const body = req.body;
    const items = parseJsonField(body.items) || [];
    const discount = parseJsonField(body.discount);
    const additionalCharges = parseJsonField(body.additionalCharges) || [];
    const { lines, subtotal, cgstTotal, sgstTotal, totalQuantity, grandTotal } = computeTotals(items, discount, additionalCharges);

    const count = await Purchase.count({ where: { userId: req.user.id } });

    const payload = {
      userId: req.user.id,
      source: 'created',
      purchaseNo: body.purchaseNo || nextPurchaseNo(count),
      invoiceNo: body.invoiceNo || null,
      poNumber: body.poNumber || null,
      title: body.title || 'Purchase',
      subtitle: body.subtitle || null,
      purchaseDate: body.purchaseDate,
      dueDate: body.dueDate || null,
      vendorId: body.vendorId || null,
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
      isRecurring: body.isRecurring === 'true' || body.isRecurring === true,
      status: body.status === 'Draft' ? 'Draft' : (body.status || 'Sent'),
    };
    if (req.file) payload.logoPath = toPublicPath(req.file.path);

    const purchase = await Purchase.create(payload);
    res.json({ success: true, data: purchase.toJSON() });
  } catch (err) {
    console.error('createPurchase error:', err);
    res.status(500).json({ success: false, message: 'Failed to create purchase' });
  }
};

// @route PATCH /api/purchases/:id   (multipart, optional field "logo")
exports.updatePurchase = async (req, res) => {
  try {
    const purchase = await Purchase.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase not found' });
    if (purchase.source !== 'created') return res.status(400).json({ success: false, message: 'Uploaded purchases cannot be edited — delete and re-upload instead' });

    const body = req.body;
    const items = body.items !== undefined ? (parseJsonField(body.items) || []) : purchase.items;
    const discount = body.discount !== undefined ? parseJsonField(body.discount) : purchase.discount;
    const additionalCharges = body.additionalCharges !== undefined ? (parseJsonField(body.additionalCharges) || []) : purchase.additionalCharges;
    const { lines, subtotal, cgstTotal, sgstTotal, totalQuantity, grandTotal } = computeTotals(items, discount, additionalCharges);

    const FIELDS = ['invoiceNo', 'poNumber', 'title', 'subtitle', 'purchaseDate', 'dueDate', 'vendorId', 'currency', 'notes', 'terms', 'status'];
    for (const f of FIELDS) if (body[f] !== undefined) purchase[f] = body[f] || null;
    if (body.shippingEnabled !== undefined) purchase.shippingEnabled = body.shippingEnabled === 'true' || body.shippingEnabled === true;
    if (body.shippingFrom !== undefined) purchase.shippingFrom = parseJsonField(body.shippingFrom);
    if (body.shippingTo !== undefined) purchase.shippingTo = parseJsonField(body.shippingTo);
    if (body.isRecurring !== undefined) purchase.isRecurring = body.isRecurring === 'true' || body.isRecurring === true;
    purchase.items = lines;
    purchase.discount = discount;
    purchase.additionalCharges = additionalCharges;
    purchase.subtotal = subtotal;
    purchase.cgstTotal = cgstTotal;
    purchase.sgstTotal = sgstTotal;
    purchase.grandTotal = grandTotal;
    purchase.totalQuantity = totalQuantity;

    if (req.file) {
      const oldDisk = toDiskPath(purchase.logoPath);
      if (oldDisk && fs.existsSync(oldDisk)) fs.unlink(oldDisk, () => {});
      purchase.logoPath = toPublicPath(req.file.path);
    }

    await purchase.save();
    res.json({ success: true, data: purchase.toJSON() });
  } catch (err) {
    console.error('updatePurchase error:', err);
    res.status(500).json({ success: false, message: 'Failed to update purchase' });
  }
};

// @route PATCH /api/purchases/:id/status   { status }
exports.setStatus = async (req, res) => {
  try {
    const purchase = await Purchase.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase not found' });
    if (!['Draft', 'Sent', 'Accepted', 'Rejected'].includes(req.body.status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    purchase.status = req.body.status;
    await purchase.save();
    res.json({ success: true, data: purchase.toJSON() });
  } catch (err) {
    console.error('setStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
};

// @route DELETE /api/purchases/:id
exports.deletePurchase = async (req, res) => {
  try {
    const purchase = await Purchase.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase not found' });
    const logoDisk = toDiskPath(purchase.logoPath);
    if (logoDisk && fs.existsSync(logoDisk)) fs.unlink(logoDisk, () => {});
    const fileDisk = toDiskPath(purchase.uploadedFilePath);
    if (fileDisk && fs.existsSync(fileDisk)) fs.unlink(fileDisk, () => {});
    await purchase.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deletePurchase error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete purchase' });
  }
};

// @route POST /api/purchases/upload   (multipart, field "file")
exports.uploadPurchase = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const count = await Purchase.count({ where: { userId: req.user.id } });
    const purchase = await Purchase.create({
      userId: req.user.id,
      source: 'uploaded',
      purchaseNo: req.body.purchaseNo || nextPurchaseNo(count),
      invoiceNo: req.body.invoiceNo || null,
      poNumber: req.body.poNumber || null,
      purchaseDate: req.body.purchaseDate || new Date().toISOString().slice(0, 10),
      vendorId: req.body.vendorId || null,
      status: 'Sent',
      uploadedFilePath: toPublicPath(req.file.path),
      uploadedFileName: req.file.originalname,
    });
    res.json({ success: true, data: purchase.toJSON() });
  } catch (err) {
    console.error('uploadPurchase error:', err);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

exports.downloadUploadedFile = async (req, res) => {
  try {
    const purchase = await Purchase.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!purchase || !purchase.uploadedFilePath) return res.status(404).json({ success: false, message: 'File not found' });
    const diskPath = toDiskPath(purchase.uploadedFilePath);
    if (!fs.existsSync(diskPath)) return res.status(404).json({ success: false, message: 'File not found' });
    res.download(diskPath, purchase.uploadedFileName || 'purchase');
  } catch (err) {
    console.error('downloadUploadedFile error:', err);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
};

function vendorLabelAndAddress(profile) {
  const info = profile?.companyInfo || {};
  const addr = profile?.registeredAddress || {};
  const name = info.tradeName || info.legalName || info.shortName || '';
  const addressLine = [addr.line1, addr.line2, addr.city, addr.district, addr.state, addr.country, addr.pincode].filter(Boolean).join(', ');
  return { name, addressLine, gstin: info.gstin || '', pan: info.pan || '' };
}

// @route GET /api/purchases/:id/pdf
exports.downloadPdf = async (req, res) => {
  try {
    const purchase = await Purchase.findOne({ where: { id: req.params.id, userId: req.user.id }, include: [{ model: Vendor, as: 'vendor' }] });
    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase not found' });
    if (purchase.source === 'uploaded') return exports.downloadUploadedFile(req, res);

    const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
    const billedTo = vendorLabelAndAddress(profile);
    const vendor = purchase.vendor;
    const currencySymbol = purchase.currency === 'INR' ? 'Rs.' : purchase.currency;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${purchase.purchaseNo}.pdf"`);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    doc.fontSize(20).fillColor('#060F1D').text(purchase.title || 'Purchase', { align: 'center' });
    if (purchase.subtitle) doc.fontSize(10).fillColor('#6b7280').text(purchase.subtitle, { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(9).fillColor('#111827');
    const metaTop = doc.y;
    doc.text(`Purchase No: ${purchase.purchaseNo}`, 40, metaTop);
    if (purchase.invoiceNo) doc.text(`Invoice No: ${purchase.invoiceNo}`, 40);
    if (purchase.poNumber) doc.text(`PO Number: ${purchase.poNumber}`, 40);
    doc.text(`Purchase Date: ${purchase.purchaseDate}`, 40);
    if (purchase.dueDate) doc.text(`Due Date: ${purchase.dueDate}`, 40);
    doc.moveDown(1);

    const colWidth = 260;
    const leftX = 40;
    const rightX = 320;
    const blockTop = doc.y;

    doc.fontSize(10).fillColor('#1E4373').text('Billed To', leftX, blockTop, { width: colWidth });
    doc.fontSize(9).fillColor('#111827').text(billedTo.name || '-', leftX, doc.y, { width: colWidth });
    if (billedTo.addressLine) doc.fillColor('#4b5563').text(billedTo.addressLine, { width: colWidth });
    if (billedTo.gstin) doc.fillColor('#4b5563').text(`GSTIN: ${billedTo.gstin}`, { width: colWidth });
    if (billedTo.pan) doc.fillColor('#4b5563').text(`PAN: ${billedTo.pan}`, { width: colWidth });

    doc.fontSize(10).fillColor('#1E4373').text('Billed By', rightX, blockTop, { width: colWidth });
    doc.fontSize(9).fillColor('#111827').text(vendor?.businessName || '-', rightX, doc.y, { width: colWidth });
    const vendorAddr = vendor ? [vendor.streetAddress, vendor.city, vendor.state, vendor.country, vendor.postalCode].filter(Boolean).join(', ') : '';
    if (vendorAddr) doc.fillColor('#4b5563').text(vendorAddr, rightX, doc.y, { width: colWidth });
    if (vendor?.gstin) doc.fillColor('#4b5563').text(`GSTIN: ${vendor.gstin}`, rightX, doc.y, { width: colWidth });
    if (vendor?.pan) doc.fillColor('#4b5563').text(`PAN: ${vendor.pan}`, rightX, doc.y, { width: colWidth });

    doc.moveDown(2);

    const items = purchase.items || [];
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
    doc.text(`Subtotal: ${currencySymbol} ${purchase.subtotal}`, totalsX, doc.y, { width: 200, align: 'right' });
    doc.text(`CGST: ${currencySymbol} ${purchase.cgstTotal}`, totalsX, doc.y, { width: 200, align: 'right' });
    doc.text(`SGST: ${currencySymbol} ${purchase.sgstTotal}`, totalsX, doc.y, { width: 200, align: 'right' });
    if (purchase.discount?.value) doc.text(`Discount: -${currencySymbol} ${purchase.discount.amount || 0}`, totalsX, doc.y, { width: 200, align: 'right' });
    doc.fontSize(11).fillColor('#1E4373').text(`Grand Total: ${currencySymbol} ${purchase.grandTotal}`, totalsX, doc.y, { width: 200, align: 'right' });

    doc.moveDown(1);
    doc.fontSize(8).fillColor('#6b7280').text(`Amount in words: ${totalInWords(Number(purchase.grandTotal), purchase.currency)}`, 40);

    if (purchase.terms) { doc.moveDown(1); doc.fontSize(9).fillColor('#111827').text('Terms & Conditions', 40, doc.y); doc.fontSize(8).fillColor('#4b5563').text(purchase.terms, 40); }
    if (purchase.notes) { doc.moveDown(1); doc.fontSize(9).fillColor('#111827').text('Notes', 40, doc.y); doc.fontSize(8).fillColor('#4b5563').text(purchase.notes, 40); }

    doc.end();
  } catch (err) {
    console.error('downloadPdf error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to generate PDF' });
  }
};
