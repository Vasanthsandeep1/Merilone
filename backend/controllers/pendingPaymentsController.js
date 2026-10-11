const PDFDocument = require('pdfkit');
const { Op } = require('sequelize');
const { Quotation, Client, PartnerProfile, LatePaymentFine } = require('../models');
const { paidByInvoice, round2 } = require('../utils/advances');
const { companyLabelAndAddress, totalInWords, EMAIL_RE } = require('./quotationController').pdfHelpers;

// Sales & Invoices > Pending Payments — invoices past their due date that
// still have money owed, and the late-payment fines charged on them.
//
// "Overdue" = an in-app invoice (not rejected) whose due date (validTillDate)
// is before today and whose balance (grand total minus payments applied to it
// via PaymentAllocation) is above zero. A fine is a percentage of the balance
// due at the time it's charged; see models/LatePaymentFine.js.

// Calendar date in India, where every partner works — not the server's UTC day.
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const daysBetween = (from, to) => Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400000);

// A late-payment charge is part of the value of the supply (CGST Act s.15(2)(d)),
// so it's taxed at the invoice's own GST rate: total CGST+SGST over the taxable
// value (subtotal less discount). Used as the default; the partner can change it.
function invoiceGstRate(inv) {
  const tax = Number(inv.cgstTotal || 0) + Number(inv.sgstTotal || 0);
  let discount = inv.discount;
  if (typeof discount === 'string') { try { discount = JSON.parse(discount); } catch { discount = null; } }
  const taxable = Number(inv.subtotal || 0) - Number(discount?.amount || 0);
  return taxable > 0 ? round2((tax / taxable) * 100) : 0;
}
// What the client owes for a fine: the fine plus GST on it.
const fineWithGst = (f) => Number(f.fineAmount) + Number(f.gstAmount || 0);

async function overdueInvoices(userId, { clientId, search } = {}) {
  const where = {
    userId, docType: 'invoice', source: 'created', status: { [Op.ne]: 'Rejected' },
    validTillDate: { [Op.lt]: today() },
  };
  if (clientId) where.clientId = clientId;
  if (search) where[Op.or] = [{ quotationNo: { [Op.like]: `%${search}%` } }, { poNumber: { [Op.like]: `%${search}%` } }];

  const invoices = await Quotation.findAll({
    where,
    include: [{ model: Client, as: 'client', attributes: ['id', 'businessName', 'email', 'logoPath'] }],
    order: [['validTillDate', 'ASC']],
  });
  const paid = await paidByInvoice(invoices.map((i) => i.id));
  const fines = invoices.length
    ? await LatePaymentFine.findAll({ where: { userId, invoiceId: invoices.map((i) => i.id) }, order: [['createdAt', 'DESC']] })
    : [];
  const finesByInvoice = new Map();
  for (const f of fines) {
    if (!finesByInvoice.has(f.invoiceId)) finesByInvoice.set(f.invoiceId, []);
    finesByInvoice.get(f.invoiceId).push(f.toJSON());
  }

  const now = today();
  return invoices
    .map((inv) => {
      const total = Number(inv.grandTotal);
      const paidAmount = round2(paid[inv.id] || 0);
      const balanceDue = round2(total - paidAmount);
      const invFines = finesByInvoice.get(inv.id) || [];
      const finesPending = round2(invFines.filter((f) => f.status === 'Pending').reduce((s, f) => s + fineWithGst(f), 0));
      return {
        invoiceId: inv.id,
        invoiceNo: inv.quotationNo,
        invoiceDate: inv.quotationDate,
        dueDate: inv.validTillDate,
        daysOverdue: daysBetween(inv.validTillDate, now),
        poNumber: inv.poNumber,
        currency: inv.currency,
        gstRate: invoiceGstRate(inv),
        client: inv.client ? inv.client.toJSON() : null,
        grandTotal: total,
        paidAmount,
        balanceDue,
        finesPending,
        totalOutstanding: round2(balanceDue + finesPending),
        fines: invFines,
      };
    })
    .filter((r) => r.balanceDue > 0.009);
}

// @route GET /api/pending-payments?clientId=&search=
exports.list = async (req, res) => {
  try {
    const rows = await overdueInvoices(req.user.id, { clientId: req.query.clientId, search: req.query.search });
    res.json({
      success: true,
      data: rows,
      stats: {
        invoices: rows.length,
        clients: new Set(rows.map((r) => r.client?.id).filter(Boolean)).size,
        balanceDue: round2(rows.reduce((s, r) => s + r.balanceDue, 0)),
        finesPending: round2(rows.reduce((s, r) => s + r.finesPending, 0)),
      },
    });
  } catch (err) {
    console.error('pending payments list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load pending payments' });
  }
};

// Notices are numbered LPN00001… — highest existing + 1, never re-issued.
async function nextNoticeNo(userId) {
  const rows = await LatePaymentFine.findAll({ where: { userId }, attributes: ['noticeNo'], raw: true });
  const max = rows.reduce((m, r) => {
    const match = /^LPN(\d+)$/.exec(r.noticeNo || '');
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `LPN${String(max + 1).padStart(5, '0')}`;
}

// @route POST /api/pending-payments/fines   { invoiceId, finePercent, gstPercent, payBy, notes }
// Charges a fine of finePercent % on the invoice's current balance due, plus
// GST of gstPercent % on the fine (defaults to the invoice's GST rate).
exports.createFine = async (req, res) => {
  try {
    const invoiceId = parseInt(req.body.invoiceId, 10);
    const finePercent = Number(req.body.finePercent);
    if (!(finePercent > 0) || finePercent > 100) return res.status(400).json({ success: false, message: 'Enter a fine percentage between 0 and 100' });

    const row = (await overdueInvoices(req.user.id)).find((r) => r.invoiceId === invoiceId);
    if (!row) return res.status(400).json({ success: false, message: 'This invoice is not overdue, or has been paid in full' });
    const gstGiven = req.body.gstPercent !== undefined && req.body.gstPercent !== null && req.body.gstPercent !== '';
    const gstPercent = gstGiven ? Number(req.body.gstPercent) : row.gstRate;
    if (!(gstPercent >= 0) || gstPercent > 28) return res.status(400).json({ success: false, message: 'Enter a GST percentage between 0 and 28' });
    const payBy = req.body.payBy || null;
    if (payBy && payBy < today()) return res.status(400).json({ success: false, message: "The pay-by date can't be in the past" });

    const fineAmount = round2((row.balanceDue * finePercent) / 100);
    // Rounded per half so CGST + SGST on the notice add up to the GST shown.
    const gstAmount = round2(2 * round2((fineAmount * gstPercent) / 200));
    const fine = await LatePaymentFine.create({
      userId: req.user.id,
      invoiceId,
      clientId: row.client?.id || null,
      noticeNo: await nextNoticeNo(req.user.id),
      noticeDate: today(),
      dueDate: row.dueDate,
      daysOverdue: row.daysOverdue,
      balanceDue: row.balanceDue,
      finePercent,
      fineAmount,
      gstPercent,
      gstAmount,
      totalPayable: round2(row.balanceDue + fineAmount + gstAmount),
      payBy,
      notes: (req.body.notes || '').trim() || null,
    });
    res.json({ success: true, data: fine.toJSON() });
  } catch (err) {
    console.error('createFine error:', err);
    res.status(500).json({ success: false, message: 'Failed to create fine' });
  }
};

// @route PATCH /api/pending-payments/fines/:id/status   { status: Pending|Paid|Waived }
exports.setFineStatus = async (req, res) => {
  try {
    if (!['Pending', 'Paid', 'Waived'].includes(req.body.status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    const fine = await LatePaymentFine.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!fine) return res.status(404).json({ success: false, message: 'Fine not found' });
    fine.status = req.body.status;
    await fine.save();
    res.json({ success: true, data: fine.toJSON() });
  } catch (err) {
    console.error('setFineStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update fine' });
  }
};

// @route DELETE /api/pending-payments/fines/:id
exports.deleteFine = async (req, res) => {
  try {
    const fine = await LatePaymentFine.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!fine) return res.status(404).json({ success: false, message: 'Fine not found' });
    await fine.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deleteFine error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete fine' });
  }
};

// ---- Late Payment Notice PDF + email ----

async function loadFine(req) {
  const fine = await LatePaymentFine.findOne({
    where: { id: req.params.id, userId: req.user.id },
    include: [
      { model: Quotation, as: 'invoice', attributes: ['id', 'quotationNo', 'quotationDate', 'validTillDate', 'grandTotal', 'poNumber', 'poDate', 'currency'] },
      { model: Client, as: 'client' },
    ],
  });
  if (!fine) return null;
  const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
  return { fine, from: companyLabelAndAddress(profile), client: fine.client };
}

const money = (currency, n) => `${currency === 'INR' ? 'Rs.' : currency} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function drawNoticePdf(doc, fine, from, client) {
  const inv = fine.invoice;
  const cur = inv?.currency || 'INR';

  doc.fontSize(20).fillColor('#060F1D').text('Late Payment Notice', { align: 'center' });
  doc.moveDown(1);
  doc.fontSize(9).fillColor('#111827');
  doc.text(`Notice No: ${fine.noticeNo}`, 40);
  doc.text(`Notice Date: ${fine.noticeDate}`, 40);
  doc.moveDown(1);

  const top = doc.y;
  doc.fontSize(10).fillColor('#1E4373').text('From', 40, top, { width: 260 });
  doc.fontSize(9).fillColor('#111827').text(from.name || '-', 40, doc.y, { width: 260 });
  if (from.addressLine) doc.fillColor('#4b5563').text(from.addressLine, { width: 260 });
  if (from.gstin) doc.fillColor('#4b5563').text(`GSTIN: ${from.gstin}`, { width: 260 });
  const leftEnd = doc.y;
  doc.fontSize(10).fillColor('#1E4373').text('To', 320, top, { width: 235 });
  doc.fontSize(9).fillColor('#111827').text(client?.businessName || '-', 320, doc.y, { width: 235 });
  const addr = client ? [client.streetAddress, client.city, client.state, client.country, client.postalCode].filter(Boolean).join(', ') : '';
  if (addr) doc.fillColor('#4b5563').text(addr, 320, doc.y, { width: 235 });
  if (client?.gstin) doc.fillColor('#4b5563').text(`GSTIN: ${client.gstin}`, 320, doc.y, { width: 235 });
  doc.y = Math.max(leftEnd, doc.y) + 18;

  const po = inv?.poNumber ? ` (your PO No. ${inv.poNumber}${inv.poDate ? ` dated ${inv.poDate}` : ''})` : '';
  doc.fontSize(10).fillColor('#111827').text(
    `Our Invoice No. ${inv?.quotationNo} dated ${inv?.quotationDate}${po} was due for payment on ${fine.dueDate}. `
    + `As of ${fine.noticeDate}, ${money(cur, fine.balanceDue)} remains unpaid, ${fine.daysOverdue} day${fine.daysOverdue === 1 ? '' : 's'} past the due date. `
    + `A late payment charge of ${Number(fine.finePercent)}% on the outstanding amount is therefore applied`
    + `${Number(fine.gstAmount) > 0 ? `, plus GST at ${Number(fine.gstPercent)}% on the charge` : ''}, as below.`,
    40, doc.y, { width: 515 },
  );
  doc.moveDown(1.2);

  // Calculation table.
  const rows = [
    ['Invoice total', money(cur, inv?.grandTotal)],
    ['Amount received so far', money(cur, Number(inv?.grandTotal) - Number(fine.balanceDue))],
    ['Balance due', money(cur, fine.balanceDue)],
    [`Late payment charge @ ${Number(fine.finePercent)}% of balance due`, money(cur, fine.fineAmount)],
  ];
  if (Number(fine.gstAmount) > 0) {
    const half = Number(fine.gstPercent) / 2;
    const halfAmt = Number(fine.gstAmount) / 2;
    rows.push([`CGST @ ${half}% on late payment charge`, money(cur, halfAmt)]);
    rows.push([`SGST @ ${half}% on late payment charge`, money(cur, halfAmt)]);
  }
  const tableTop = doc.y;
  doc.rect(40, tableTop, 515, 18).fill('#1E4373');
  doc.fillColor('#ffffff').fontSize(8).text('Particulars', 45, tableTop + 5, { width: 350 }).text('Amount', 400, tableTop + 5, { width: 150, align: 'right' });
  doc.y = tableTop + 24;
  doc.fontSize(9).fillColor('#111827');
  for (const [label, val] of rows) {
    const y = doc.y;
    doc.text(label, 45, y, { width: 350 });
    doc.text(val, 400, y, { width: 150, align: 'right' });
    doc.y = y + 16;
  }
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#d1d5db').stroke();
  doc.y += 6;
  const y = doc.y;
  doc.fontSize(11).fillColor('#b91c1c').text('Total amount payable', 45, y, { width: 350 });
  doc.text(money(cur, fine.totalPayable), 400, y, { width: 150, align: 'right' });
  doc.y = y + 20;
  doc.fontSize(8).fillColor('#6b7280').text(`(${totalInWords(Number(fine.totalPayable), cur)})`, 45, doc.y, { width: 510 });
  doc.moveDown(1.2);

  doc.fontSize(10).fillColor('#111827').text(
    fine.payBy
      ? `Kindly remit the total amount payable on or before ${fine.payBy}. Please ignore this notice if payment has already been made.`
      : 'Kindly remit the total amount payable at the earliest. Please ignore this notice if payment has already been made.',
    40, doc.y, { width: 515 },
  );
  if (fine.notes) { doc.moveDown(1); doc.fontSize(9).fillColor('#111827').text('Notes', 40); doc.fontSize(8).fillColor('#4b5563').text(fine.notes, 40); }
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#6b7280').text('This is a computer-generated notice and does not require a signature.', 40, doc.y, { width: 515, align: 'center' });
}

function bufferNoticePdf(fine, from, client) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawNoticePdf(doc, fine, from, client);
    doc.end();
  });
}

// @route GET /api/pending-payments/fines/:id/pdf
exports.downloadNotice = async (req, res) => {
  try {
    const found = await loadFine(req);
    if (!found) return res.status(404).json({ success: false, message: 'Fine not found' });
    const buffer = await bufferNoticePdf(found.fine, found.from, found.client);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${found.fine.noticeNo}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('downloadNotice error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate notice' });
  }
};

// @route POST /api/pending-payments/fines/:id/email   { to, cc, subject, message }
exports.emailNotice = async (req, res) => {
  try {
    const found = await loadFine(req);
    if (!found) return res.status(404).json({ success: false, message: 'Fine not found' });
    const { fine, from, client } = found;

    const parseList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((e) => e.trim()).filter(Boolean);
    const to = parseList(req.body?.to);
    if (!to.length && client?.email) to.push(client.email);
    const cc = parseList(req.body?.cc);
    if (!to.length) return res.status(400).json({ success: false, message: 'Enter an email address to send to.' });
    const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e));
    if (bad) return res.status(400).json({ success: false, message: `"${bad}" isn't a valid email address.` });

    const { sendMail, isMailConfigured } = require('../utils/mailer');
    if (!isMailConfigured()) return res.status(503).json({ success: false, message: 'Email sending is not configured on this server. Add the EMAIL_* settings to backend/.env.' });

    const buffer = await bufferNoticePdf(fine, from, client);
    const inv = fine.invoice;
    const subject = (req.body?.subject || '').trim() || `Late Payment Notice ${fine.noticeNo} — Invoice ${inv?.quotationNo}`;
    const text = (req.body?.message || '').trim()
      || `Dear ${client?.businessName || 'Sir/Madam'},\n\nInvoice ${inv?.quotationNo} is overdue. Please find attached late payment notice ${fine.noticeNo}.\n\nRegards,\n${from.name || ''}`;
    await sendMail({
      to: to.join(', '),
      cc: cc.length ? cc.join(', ') : undefined,
      subject,
      text,
      attachments: [{ filename: `${fine.noticeNo}.pdf`, content: buffer, contentType: 'application/pdf' }],
    });

    fine.sentAt = new Date();
    fine.sentTo = [...to, ...cc].join(', ').slice(0, 500);
    await fine.save();
    res.json({ success: true, data: { sentAt: fine.sentAt, sentTo: fine.sentTo } });
  } catch (err) {
    console.error('emailNotice error:', err);
    res.status(500).json({ success: false, message: 'Failed to send email' });
  }
};
