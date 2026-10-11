const { Op, fn, col } = require('sequelize');
const PDFDocument = require('pdfkit');
const { PaymentReceipt, PaymentAllocation, Quotation, Client, PartnerProfile } = require('../models');
const { companyLabelAndAddress, totalInWords, EMAIL_RE } = require('./quotationController').pdfHelpers;

// Sales & Invoices > Payment Receipts. "Payment Receipt" (paymentType
// 'receipt') walks the user through allocating the money against that
// client's real unpaid invoices; "Client Advance" (paymentType 'advance')
// records it as pure advance with no allocation step. Every "unpaid
// invoice" figure shown to the user is computed live from real Invoice
// records (Quotation rows with docType='invoice') minus whatever has
// actually been allocated so far via PaymentAllocation — never a fabricated
// balance.

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Receipts are numbered RCPT00001… — highest existing + 1, so a deleted
// receipt never causes a number to be re-issued. (Older receipts were
// numbered A00001…, which clashed with quotation numbers; those keep their
// numbers and simply don't count toward the RCPT sequence.)
async function nextReceiptNo(userId) {
  const rows = await PaymentReceipt.findAll({ where: { userId }, attributes: ['receiptNo'], raw: true });
  const max = rows.reduce((m, r) => {
    const match = /^RCPT(\d+)$/.exec(r.receiptNo || '');
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `RCPT${String(max + 1).padStart(5, '0')}`;
}

// An advance may name the Sales Order it was paid for; it must be this
// partner's own Sales Order for the same client.
async function resolveSalesOrderId(req, body, paymentType, clientId) {
  if (paymentType !== 'advance' || !body.salesOrderId) return { id: null };
  const so = await Quotation.findOne({ where: { id: body.salesOrderId, userId: req.user.id, docType: 'sales_order' } });
  if (!so) return { error: 'Sales Order not found' };
  if (clientId && so.clientId && String(so.clientId) !== String(clientId)) return { error: 'That Sales Order belongs to a different client' };
  return { id: so.id };
}

// @route GET /api/payment-receipts/next-number
exports.getNextNumber = async (req, res) => {
  try {
    res.json({ success: true, receiptNo: await nextReceiptNo(req.user.id) });
  } catch (err) {
    console.error('getNextNumber error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate receipt number' });
  }
};

// Computes, for every 'Sent' invoice belonging to this client, how much of
// its grandTotal has already been allocated across all of this partner's
// payment receipts, and returns only the ones still owing money.
// @route GET /api/payment-receipts/unpaid-invoices?clientId=
exports.getUnpaidInvoices = async (req, res) => {
  try {
    const clientId = req.query.clientId;
    if (!clientId) return res.json({ success: true, data: [] });

    const invoices = await Quotation.findAll({
      // Any invoice can be paid — the client may have got it outside the
      // portal (a PDF you emailed yourself, a printed copy).
      where: { userId: req.user.id, clientId, docType: 'invoice', source: 'created', status: { [Op.ne]: 'Rejected' } },
      order: [['quotationDate', 'ASC']],
    });
    if (invoices.length === 0) return res.json({ success: true, data: [] });

    const allocated = await PaymentAllocation.findAll({
      attributes: ['invoiceId', [fn('SUM', col('amount')), 'total']],
      where: { invoiceId: invoices.map((i) => i.id) },
      group: ['invoiceId'],
    });
    const allocatedMap = new Map(allocated.map((a) => [a.invoiceId, Number(a.get('total')) || 0]));

    const data = invoices
      .map((inv) => {
        const paid = round2(allocatedMap.get(inv.id) || 0);
        const remaining = round2(Number(inv.grandTotal) - paid);
        return { invoiceId: inv.id, quotationNo: inv.quotationNo, quotationDate: inv.quotationDate, grandTotal: Number(inv.grandTotal), paid, remaining };
      })
      .filter((i) => i.remaining > 0.009);

    res.json({ success: true, data });
  } catch (err) {
    console.error('getUnpaidInvoices error:', err);
    res.status(500).json({ success: false, message: 'Failed to load unpaid invoices' });
  }
};

// @route GET /api/payment-receipts
exports.listPaymentReceipts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const { search, status, clientId, paymentType, dateFrom, dateTo } = req.query;

    const where = { userId: req.user.id };
    if (status) where.status = status;
    if (clientId) where.clientId = clientId;
    if (paymentType) where.paymentType = paymentType;
    if (dateFrom || dateTo) {
      where.receiptDate = {};
      if (dateFrom) where.receiptDate[Op.gte] = dateFrom;
      if (dateTo) where.receiptDate[Op.lte] = dateTo;
    }
    if (search) where.receiptNo = { [Op.like]: `%${search}%` };

    const { rows, count } = await PaymentReceipt.findAndCountAll({
      where,
      include: [
        { model: Client, as: 'client', attributes: ['id', 'businessName', 'logoPath'] },
        { model: PaymentAllocation, as: 'allocations', include: [{ model: Quotation, as: 'invoice', attributes: ['id', 'quotationNo'] }] },
        { model: Quotation, as: 'salesOrder', attributes: ['id', 'quotationNo', 'poNumber'] },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    res.json({ success: true, data: rows.map((r) => r.toJSON()), total: count, page, limit, totalPages: Math.max(1, Math.ceil(count / limit)) });
  } catch (err) {
    console.error('listPaymentReceipts error:', err);
    res.status(500).json({ success: false, message: 'Failed to load payment receipts' });
  }
};

// @route GET /api/payment-receipts/stats
exports.getStats = async (req, res) => {
  try {
    const [total, draft] = await Promise.all([
      PaymentReceipt.count({ where: { userId: req.user.id } }),
      PaymentReceipt.count({ where: { userId: req.user.id, status: 'Draft' } }),
    ]);
    res.json({ success: true, total, draft });
  } catch (err) {
    console.error('getStats error:', err);
    res.status(500).json({ success: false, message: 'Failed to load stats' });
  }
};

// @route GET /api/payment-receipts/:id
exports.getPaymentReceipt = async (req, res) => {
  try {
    const receipt = await PaymentReceipt.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: [{ model: Client, as: 'client' }, { model: PaymentAllocation, as: 'allocations', include: [{ model: Quotation, as: 'invoice' }] }, { model: Quotation, as: 'salesOrder', attributes: ['id', 'quotationNo', 'poNumber', 'poDate'] }],
    });
    if (!receipt) return res.status(404).json({ success: false, message: 'Payment receipt not found' });
    res.json({ success: true, data: receipt.toJSON() });
  } catch (err) {
    console.error('getPaymentReceipt error:', err);
    res.status(500).json({ success: false, message: 'Failed to load payment receipt' });
  }
};

// totalReceived (what settles invoices) is the gross amount received: TDS the
// customer deducted is paid on your behalf, and bank charges are your cost —
// neither leaves the invoice unpaid. netAmount is what actually hit the bank.
function computeRecords(paymentRecords) {
  return (paymentRecords || []).map((r) => {
    const amountReceived = Number(r.amountReceived) || 0;
    const tdsPercent = Number(r.tdsPercent) || 0;
    const tdsAmount = round2((amountReceived * tdsPercent) / 100);
    const transactionCharge = Number(r.transactionCharge) || 0;
    const netAmount = round2(amountReceived - tdsAmount - transactionCharge);
    return { ...r, amountReceived, tdsPercent, tdsAmount, transactionCharge, netAmount };
  });
}

async function applyAllocations(receiptId, allocations, userId) {
  await PaymentAllocation.destroy({ where: { paymentReceiptId: receiptId } });
  const clean = (allocations || []).filter((a) => a.invoiceId && Number(a.amount) > 0);
  if (!clean.length) return 0;

  const invoices = await Quotation.findAll({ where: { id: clean.map((a) => a.invoiceId), userId, docType: 'invoice' } });
  const validIds = new Set(invoices.map((i) => i.id));

  let total = 0;
  const rows = [];
  for (const a of clean) {
    if (!validIds.has(a.invoiceId)) continue;
    const amount = round2(Number(a.amount));
    total += amount;
    rows.push({ paymentReceiptId: receiptId, invoiceId: a.invoiceId, amount });
  }
  if (rows.length) await PaymentAllocation.bulkCreate(rows);
  return round2(total);
}

// @route POST /api/payment-receipts
exports.createPaymentReceipt = async (req, res) => {
  try {
    const body = req.body;
    const paymentType = body.paymentType === 'advance' ? 'advance' : 'receipt';
    const paymentRecords = computeRecords(body.paymentRecords);
    const totalReceived = round2(paymentRecords.reduce((s, r) => s + r.amountReceived, 0));

    const so = await resolveSalesOrderId(req, body, paymentType, body.clientId);
    if (so.error) return res.status(400).json({ success: false, message: so.error });
    const receipt = await PaymentReceipt.create({
      userId: req.user.id,
      receiptNo: body.receiptNo || await nextReceiptNo(req.user.id),
      paymentType,
      clientId: body.clientId || null,
      salesOrderId: so.id,
      receivedFrom: body.receivedFrom || null,
      receiptDate: body.receiptDate,
      currency: body.currency || 'INR',
      paymentRecords,
      totalReceived,
      totalAllocated: 0,
      advanceAmount: totalReceived,
      notes: body.notes || null,
      status: body.status === 'Draft' ? 'Draft' : (body.status || 'Saved'),
    });

    const totalAllocated = paymentType === 'advance' ? 0 : await applyAllocations(receipt.id, body.allocations, req.user.id);
    receipt.totalAllocated = totalAllocated;
    receipt.advanceAmount = round2(totalReceived - totalAllocated);
    await receipt.save();

    res.json({ success: true, data: receipt.toJSON() });
  } catch (err) {
    console.error('createPaymentReceipt error:', err);
    res.status(500).json({ success: false, message: 'Failed to create payment receipt' });
  }
};

// @route PATCH /api/payment-receipts/:id
exports.updatePaymentReceipt = async (req, res) => {
  try {
    const receipt = await PaymentReceipt.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!receipt) return res.status(404).json({ success: false, message: 'Payment receipt not found' });

    const body = req.body;
    const FIELDS = ['receiptNo', 'clientId', 'receivedFrom', 'receiptDate', 'currency', 'notes', 'status'];
    for (const f of FIELDS) if (body[f] !== undefined) receipt[f] = body[f] || null;
    if (body.paymentType !== undefined) receipt.paymentType = body.paymentType === 'advance' ? 'advance' : 'receipt';
    if (body.salesOrderId !== undefined) {
      const so = await resolveSalesOrderId(req, body, receipt.paymentType, receipt.clientId);
      if (so.error) return res.status(400).json({ success: false, message: so.error });
      receipt.salesOrderId = so.id;
    }

    if (body.paymentRecords !== undefined) {
      const paymentRecords = computeRecords(body.paymentRecords);
      receipt.paymentRecords = paymentRecords;
      receipt.totalReceived = round2(paymentRecords.reduce((s, r) => s + r.amountReceived, 0));
    }

    // An advance's allocations are the ones made automatically when its Sales
    // Order was invoiced — keep them; a regular receipt's come from the form.
    const totalAllocated = receipt.paymentType === 'advance'
      ? round2((await PaymentAllocation.findAll({ where: { paymentReceiptId: receipt.id }, raw: true })).reduce((s, a) => s + Number(a.amount), 0))
      : await applyAllocations(receipt.id, body.allocations, req.user.id);
    if (totalAllocated > Number(receipt.totalReceived) + 0.009) {
      return res.status(400).json({ success: false, message: `This advance has already been applied (${totalAllocated}) to an invoice — the amount received can't be less than that.` });
    }
    receipt.totalAllocated = totalAllocated;
    receipt.advanceAmount = round2(Number(receipt.totalReceived) - totalAllocated);

    await receipt.save();
    res.json({ success: true, data: receipt.toJSON() });
  } catch (err) {
    console.error('updatePaymentReceipt error:', err);
    res.status(500).json({ success: false, message: 'Failed to update payment receipt' });
  }
};

// @route DELETE /api/payment-receipts/:id
exports.deletePaymentReceipt = async (req, res) => {
  try {
    const receipt = await PaymentReceipt.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!receipt) return res.status(404).json({ success: false, message: 'Payment receipt not found' });
    await PaymentAllocation.destroy({ where: { paymentReceiptId: receipt.id } });
    await receipt.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deletePaymentReceipt error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete payment receipt' });
  }
};

// ---- Receipt PDF + email ----

async function loadReceipt(req) {
  const receipt = await PaymentReceipt.findOne({
    where: { id: req.params.id, userId: req.user.id },
    include: [
      { model: Client, as: 'client' },
      { model: PaymentAllocation, as: 'allocations', include: [{ model: Quotation, as: 'invoice', attributes: ['id', 'quotationNo', 'quotationDate', 'grandTotal', 'poNumber'] }] },
      { model: Quotation, as: 'salesOrder', attributes: ['id', 'quotationNo', 'poNumber', 'poDate', 'grandTotal'] },
    ],
  });
  if (!receipt) return null;
  const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
  return { receipt, from: companyLabelAndAddress(profile), client: receipt.client };
}

const money = (currency, n) => `${currency === 'INR' ? 'Rs.' : currency} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Payment Receipt — the seller's acknowledgement to the customer that money
// was received: how much, how, when, and what it was applied to (invoices,
// or an advance against a Sales Order).
function drawReceiptPdf(doc, receipt, from, client) {
  const cur = receipt.currency;
  const isAdvance = receipt.paymentType === 'advance';
  const records = receipt.paymentRecords || [];
  const gross = records.reduce((s, r) => s + (Number(r.amountReceived) || 0), 0);
  const tds = records.reduce((s, r) => s + (Number(r.tdsAmount) || 0), 0);

  doc.fontSize(20).fillColor('#060F1D').text(isAdvance ? 'Advance Receipt' : 'Payment Receipt', { align: 'center' });
  doc.moveDown(1);
  doc.fontSize(9).fillColor('#111827');
  doc.text(`Receipt No: ${receipt.receiptNo}`, 40);
  doc.text(`Receipt Date: ${receipt.receiptDate}`, 40);
  if (receipt.salesOrder) {
    const so = receipt.salesOrder;
    const po = so.poNumber ? `  (Customer PO No: ${so.poNumber}${so.poDate ? ` dated ${so.poDate}` : ''})` : '';
    doc.text(`Against Sales Order: ${so.quotationNo}${po}`, 40);
  }
  doc.moveDown(1);

  const top = doc.y;
  doc.fontSize(10).fillColor('#1E4373').text('Received By', 40, top, { width: 260 });
  doc.fontSize(9).fillColor('#111827').text(from.name || '-', 40, doc.y, { width: 260 });
  if (from.addressLine) doc.fillColor('#4b5563').text(from.addressLine, { width: 260 });
  if (from.gstin) doc.fillColor('#4b5563').text(`GSTIN: ${from.gstin}`, { width: 260 });
  const leftEnd = doc.y;
  doc.fontSize(10).fillColor('#1E4373').text('Received From', 320, top, { width: 235 });
  doc.fontSize(9).fillColor('#111827').text(client?.businessName || receipt.receivedFrom || '-', 320, doc.y, { width: 235 });
  const addr = client ? [client.streetAddress, client.city, client.state, client.country, client.postalCode].filter(Boolean).join(', ') : '';
  if (addr) doc.fillColor('#4b5563').text(addr, 320, doc.y, { width: 235 });
  if (client?.gstin) doc.fillColor('#4b5563').text(`GSTIN: ${client.gstin}`, 320, doc.y, { width: 235 });
  doc.y = Math.max(leftEnd, doc.y) + 18;

  // The acknowledgement sentence buyers keep for their records.
  const towards = isAdvance
    ? `as advance payment${receipt.salesOrder ? ` against Sales Order ${receipt.salesOrder.quotationNo}` : ''}`
    : `towards ${(receipt.allocations || []).map((a) => `Invoice ${a.invoice?.quotationNo}`).join(', ') || 'your account'}`;
  const payer = client?.businessName || receipt.receivedFrom || 'the customer';
  doc.fontSize(10).fillColor('#111827').text(
    `Received with thanks from ${payer} the sum of ${money(cur, gross)} (${totalInWords(gross, cur)}) ${towards}.`,
    40, doc.y, { width: 515 },
  );
  doc.moveDown(1.2);

  const drawHeader = (cols) => {
    const y = doc.y;
    doc.rect(40, y, 515, 18).fill('#1E4373');
    let x = 40;
    doc.fillColor('#ffffff').fontSize(8);
    for (const [label, w] of cols) { doc.text(label, x + 5, y + 5, { width: w - 10 }); x += w; }
    doc.y = y + 22;
  };
  const drawRow = (cols, vals) => {
    const y = doc.y;
    let x = 40;
    doc.fillColor('#111827').fontSize(8);
    vals.forEach((v, i) => { doc.text(String(v), x + 5, y, { width: cols[i][1] - 10 }); x += cols[i][1]; });
    doc.y = y + 16;
  };

  // Payment details.
  const cols = [['Mode', 110], ['Reference', 125], ['Amount Received', 95], ['TDS', 60], ['Charges', 55], ['Net', 70]];
  drawHeader(cols);
  for (const r of records) {
    drawRow(cols, [r.paymentMethod || '-', r.referenceId || '-', money(cur, r.amountReceived), money(cur, r.tdsAmount), money(cur, r.transactionCharge), money(cur, r.netAmount)]);
  }
  doc.moveDown(0.8);

  // What it was applied to.
  const allocs = receipt.allocations || [];
  if (allocs.length) {
    doc.fontSize(10).fillColor('#1E4373').text(isAdvance ? 'Advance adjusted against' : 'Applied to invoices', 40);
    doc.moveDown(0.3);
    const acols = [['Invoice No', 140], ['Invoice Date', 125], ['Invoice Total', 125], ['Amount Applied', 125]];
    drawHeader(acols);
    for (const a of allocs) {
      drawRow(acols, [a.invoice?.quotationNo || '-', a.invoice?.quotationDate || '-', money(cur, a.invoice?.grandTotal), money(cur, a.amount)]);
    }
    doc.moveDown(0.8);
  }

  doc.fontSize(9).fillColor('#111827');
  doc.text(`Total received: ${money(cur, gross)}`, 300, doc.y, { width: 255, align: 'right' });
  if (tds > 0) doc.text(`TDS deducted by customer: ${money(cur, tds)}`, 300, doc.y, { width: 255, align: 'right' });
  if (Number(receipt.advanceAmount) > 0.009) doc.fillColor('#1E4373').text(`Unadjusted advance: ${money(cur, receipt.advanceAmount)}`, 300, doc.y, { width: 255, align: 'right' });

  if (receipt.notes) {
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#111827').text('Notes', 40);
    doc.fontSize(8).fillColor('#4b5563').text(receipt.notes, 40);
  }
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#6b7280').text('This is a computer-generated receipt and does not require a signature.', 40, doc.y, { width: 515, align: 'center' });
}

function bufferReceiptPdf(receipt, from, client) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawReceiptPdf(doc, receipt, from, client);
    doc.end();
  });
}

// @route GET /api/payment-receipts/:id/pdf
exports.downloadPdf = async (req, res) => {
  try {
    const found = await loadReceipt(req);
    if (!found) return res.status(404).json({ success: false, message: 'Payment receipt not found' });
    const buffer = await bufferReceiptPdf(found.receipt, found.from, found.client);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${found.receipt.receiptNo}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('receipt downloadPdf error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate receipt PDF' });
  }
};

// @route POST /api/payment-receipts/:id/email   { to, cc, subject, message }
// Emails the receipt PDF; only a successful send records sentAt/sentTo.
exports.emailReceipt = async (req, res) => {
  try {
    const found = await loadReceipt(req);
    if (!found) return res.status(404).json({ success: false, message: 'Payment receipt not found' });
    const { receipt, from, client } = found;

    const parseList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((e) => e.trim()).filter(Boolean);
    const to = parseList(req.body?.to);
    if (!to.length && client?.email) to.push(client.email);
    const cc = parseList(req.body?.cc);
    if (!to.length) return res.status(400).json({ success: false, message: 'Enter an email address to send to.' });
    const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e));
    if (bad) return res.status(400).json({ success: false, message: `"${bad}" isn't a valid email address.` });

    const { sendMail, isMailConfigured } = require('../utils/mailer');
    if (!isMailConfigured()) return res.status(503).json({ success: false, message: 'Email sending is not configured on this server. Add the EMAIL_* settings to backend/.env.' });

    const buffer = await bufferReceiptPdf(receipt, from, client);
    const subject = (req.body?.subject || '').trim() || `Payment Receipt ${receipt.receiptNo} from ${from.name || 'us'}`;
    const text = (req.body?.message || '').trim()
      || `Dear ${client?.businessName || 'Sir/Madam'},\n\nThank you for your payment. Please find attached receipt ${receipt.receiptNo}.\n\nRegards,\n${from.name || ''}`;
    await sendMail({
      to: to.join(', '),
      cc: cc.length ? cc.join(', ') : undefined,
      subject,
      text,
      attachments: [{ filename: `${receipt.receiptNo}.pdf`, content: buffer, contentType: 'application/pdf' }],
    });

    receipt.sentAt = new Date();
    receipt.sentTo = [...to, ...cc].join(', ').slice(0, 500);
    await receipt.save();
    res.json({ success: true, data: { sentAt: receipt.sentAt, sentTo: receipt.sentTo } });
  } catch (err) {
    console.error('emailReceipt error:', err);
    res.status(500).json({ success: false, message: 'Failed to send email' });
  }
};
