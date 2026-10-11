const { Op } = require('sequelize');
const { Quotation, Client, PaymentReceipt, PaymentAllocation, LatePaymentFine } = require('../models');
const { paidByInvoice, round2 } = require('../utils/advances');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');

// Tracker > AR Tracker — accounts receivable: money clients still owe, per
// client, split into aging buckets by how far past the due date it is.
//
// Owed = each in-app invoice (not Rejected) grand total minus the payments
// applied to it (PaymentAllocation). Unapplied credit = money a client paid
// (saved receipts/advances) that isn't applied to any invoice yet — it will
// reduce what they owe once applied, so it's shown beside the balance.
// Late-payment fines still Pending are shown separately (not in the buckets).

const BUCKETS = [
  { key: 'current', label: 'Not yet due' },
  { key: 'd1_30', label: '1–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd61_90', label: '61–90 days' },
  { key: 'd90p', label: '90+ days' },
];
const bucketFor = (daysOverdue) => (daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? 'd1_30' : daysOverdue <= 60 ? 'd31_60' : daysOverdue <= 90 ? 'd61_90' : 'd90p');
const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b.key, 0]));

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const daysBetween = (from, to) => Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400000);

// @route GET /api/ar-tracker?search=&clientId=&bucket=
exports.list = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search = '', clientId = '', bucket = '' } = req.query;
    const now = today();

    const invoices = await Quotation.findAll({
      where: { userId, docType: 'invoice', source: 'created', status: { [Op.ne]: 'Rejected' } },
      attributes: ['id', 'quotationNo', 'quotationDate', 'validTillDate', 'grandTotal', 'poNumber', 'clientId'],
      include: [{ model: Client, as: 'client', attributes: ['id', 'businessName', 'email', 'phone'] }],
      order: [['validTillDate', 'ASC']],
    });
    const paid = await paidByInvoice(invoices.map((i) => i.id));

    // Unapplied credit per client: received minus actually allocated.
    const receipts = await PaymentReceipt.findAll({ where: { userId, status: 'Saved' }, attributes: ['id', 'clientId', 'totalReceived'] });
    const allocs = receipts.length
      ? await PaymentAllocation.findAll({ where: { paymentReceiptId: receipts.map((r) => r.id) }, attributes: ['paymentReceiptId', 'amount'], raw: true })
      : [];
    const allocated = {};
    for (const a of allocs) allocated[a.paymentReceiptId] = (allocated[a.paymentReceiptId] || 0) + Number(a.amount);
    const unapplied = {};
    for (const r of receipts) {
      const left = Number(r.totalReceived) - (allocated[r.id] || 0);
      if (r.clientId && left > 0.009) unapplied[r.clientId] = (unapplied[r.clientId] || 0) + left;
    }

    const fines = await LatePaymentFine.findAll({ where: { userId, status: 'Pending' }, attributes: ['clientId', 'fineAmount', 'gstAmount'], raw: true });
    const finesByClient = {};
    for (const f of fines) if (f.clientId) finesByClient[f.clientId] = (finesByClient[f.clientId] || 0) + Number(f.fineAmount) + Number(f.gstAmount || 0);

    const clients = new Map();
    for (const inv of invoices) {
      const balance = round2(Number(inv.grandTotal) - (paid[inv.id] || 0));
      if (balance <= 0.009 || !inv.client) continue;
      const daysOverdue = inv.validTillDate ? daysBetween(inv.validTillDate, now) : 0;
      const b = bucketFor(daysOverdue);
      const c = clients.get(inv.client.id) || {
        client: inv.client.toJSON(), buckets: emptyBuckets(), outstanding: 0, overdue: 0, oldestDaysOverdue: 0, invoices: [],
      };
      c.buckets[b] = round2(c.buckets[b] + balance);
      c.outstanding = round2(c.outstanding + balance);
      if (daysOverdue > 0) c.overdue = round2(c.overdue + balance);
      c.oldestDaysOverdue = Math.max(c.oldestDaysOverdue, daysOverdue);
      c.invoices.push({
        invoiceId: inv.id, invoiceNo: inv.quotationNo, invoiceDate: inv.quotationDate, dueDate: inv.validTillDate,
        poNumber: inv.poNumber, grandTotal: Number(inv.grandTotal), paidAmount: round2(paid[inv.id] || 0),
        balance, daysOverdue, bucket: b,
      });
      clients.set(inv.client.id, c);
    }

    let rows = [...clients.values()].map((c) => {
      const credit = round2(unapplied[c.client.id] || 0);
      return {
        ...c,
        unappliedCredit: credit,
        netReceivable: round2(Math.max(0, c.outstanding - credit)),
        finesPending: round2(finesByClient[c.client.id] || 0),
      };
    });

    // Totals over every client (before filters).
    const stats = {
      clients: rows.length,
      invoices: rows.reduce((s, r) => s + r.invoices.length, 0),
      outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
      overdue: round2(rows.reduce((s, r) => s + r.overdue, 0)),
      unappliedCredit: round2(rows.reduce((s, r) => s + r.unappliedCredit, 0)),
      finesPending: round2(rows.reduce((s, r) => s + r.finesPending, 0)),
      buckets: Object.fromEntries(BUCKETS.map((b) => [b.key, round2(rows.reduce((s, r) => s + r.buckets[b.key], 0))])),
    };

    const s = search.trim().toLowerCase();
    if (s) {
      rows = rows.filter((r) => (r.client.businessName || '').toLowerCase().includes(s)
        || r.invoices.some((i) => [i.invoiceNo, i.poNumber].some((v) => (v || '').toLowerCase().includes(s))));
    }
    if (clientId) rows = rows.filter((r) => String(r.client.id) === String(clientId));
    if (bucket === 'overdue') rows = rows.filter((r) => r.overdue > 0);
    else if (BUCKETS.some((b) => b.key === bucket)) rows = rows.filter((r) => r.buckets[bucket] > 0);

    // Oldest debt first, then biggest.
    rows.sort((a, b) => b.oldestDaysOverdue - a.oldestDaysOverdue || b.outstanding - a.outstanding);
    res.json({ success: true, data: rows, total: rows.length, stats, buckets: BUCKETS });
  } catch (err) {
    console.error('ar tracker list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load AR tracker' });
  }
};

// @route GET /api/ar-tracker/export?mode=all|filtered&...filters — one row per unpaid invoice.
exports.exportExcel = safeHandler('ar tracker', async (req, res) => {
  const bucketLabel = Object.fromEntries(BUCKETS.map((b) => [b.key, b.label]));
  const { rows, mode, applied } = await collectRows(exports.list, req, {
    clear: ['search', 'clientId', 'bucket'],
    paged: false,
    pick: (payload) => payload.data.flatMap((c) => c.invoices.map((i) => ({ ...i, client: c.client, unappliedCredit: c.unappliedCredit }))),
  });
  await sendWorkbook(res, {
    title: 'AR Tracker', rows, mode, applied,
    columns: [
      { header: 'Client', get: (r) => r.client.businessName, width: 32 },
      { header: 'Client Email', get: (r) => r.client.email, width: 28 },
      { header: 'Invoice No', key: 'invoiceNo', width: 13 },
      { header: 'Invoice Date', key: 'invoiceDate', width: 13, type: 'date' },
      { header: 'Customer PO', key: 'poNumber', width: 20 },
      { header: 'Due Date', key: 'dueDate', width: 13, type: 'date' },
      { header: 'Invoice Total', key: 'grandTotal', width: 15, type: 'money' },
      { header: 'Received', key: 'paidAmount', width: 14, type: 'money' },
      { header: 'Balance Owed', key: 'balance', width: 15, type: 'money' },
      { header: 'Days Overdue', get: (r) => Math.max(0, r.daysOverdue), width: 12, type: 'number' },
      { header: 'Aging', get: (r) => bucketLabel[r.bucket], width: 13 },
    ],
  });
});
