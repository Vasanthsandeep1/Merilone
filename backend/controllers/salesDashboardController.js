const { Op } = require('sequelize');
const { Quotation, Client, PaymentReceipt, PaymentAllocation, LatePaymentFine } = require('../models');
const { paidByInvoice, round2 } = require('../utils/advances');

// Sales & Invoices > Dashboard — one screen for a sales head: how much we've
// sold and collected this financial year, what's owed and overdue, the
// order pipeline (quotation -> sales order -> invoice -> paid), who buys and
// what sells, and the items that need action today.
//
// Sales = in-app invoices (not Rejected), dated in the period. Values are
// shown both before GST (subtotal: what we actually earned) and with GST
// (grand total: what the client pays). Collected = saved payment receipts
// dated in the period. Indian financial year: 1 April – 31 March.

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const daysBetween = (from, to) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
// Balances under ₹1 (paise left by rounding) count as settled here.
const SETTLED_BELOW = 1;
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

// FY starting year for a date: Apr 2026 – Mar 2027 -> 2026.
const fyOf = (d) => { const [y, m] = d.split('-').map(Number); return m >= 4 ? y : y - 1; };
const fyRange = (startYear) => ({ from: `${startYear}-04-01`, to: `${startYear + 1}-03-31`, label: `FY ${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}` });
const monthKey = (d) => d.slice(0, 7);
const sum = (list, f) => round2(list.reduce((s, x) => s + f(x), 0));

// @route GET /api/sales-dashboard?fy=2026
exports.get = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = today();
    const fyStart = Number(req.query.fy) || fyOf(now);
    const fy = fyRange(fyStart);
    const thisMonth = monthKey(now);
    const prev = new Date(`${thisMonth}-01T00:00:00`); prev.setMonth(prev.getMonth() - 1);
    const lastMonth = prev.toLocaleDateString('en-CA').slice(0, 7);

    const docs = await Quotation.findAll({
      where: { userId, source: 'created', status: { [Op.ne]: 'Rejected' }, docType: ['quotation', 'sales_order', 'invoice'] },
      attributes: ['id', 'docType', 'quotationNo', 'quotationDate', 'validTillDate', 'status', 'subtotal', 'grandTotal', 'items', 'clientId', 'sourceQuotationId', 'poNumber', 'createdAt'],
      include: [{ model: Client, as: 'client', attributes: ['id', 'businessName'] }],
    });
    const quotations = docs.filter((d) => d.docType === 'quotation');
    const salesOrders = docs.filter((d) => d.docType === 'sales_order');
    const invoices = docs.filter((d) => d.docType === 'invoice');
    const hasChild = (parent, type) => docs.some((d) => d.docType === type && d.sourceQuotationId === parent.id);

    const paid = await paidByInvoice(invoices.map((i) => i.id));
    const balanceOf = (inv) => round2(Number(inv.grandTotal) - (paid[inv.id] || 0));

    const inFy = (d) => d >= fy.from && d <= fy.to;
    const fyInvoices = invoices.filter((i) => inFy(i.quotationDate));
    const receipts = await PaymentReceipt.findAll({ where: { userId, status: 'Saved' }, attributes: ['id', 'receiptNo', 'receiptDate', 'totalReceived', 'clientId', 'paymentType'], include: [{ model: Client, as: 'client', attributes: ['businessName'] }] });
    const fyReceipts = receipts.filter((r) => inFy(r.receiptDate));
    // Of the money received, how much isn't applied to any invoice yet
    // (advances, or receipts saved without choosing an invoice).
    const allocs = fyReceipts.length
      ? await PaymentAllocation.findAll({ where: { paymentReceiptId: fyReceipts.map((r) => r.id) }, attributes: ['paymentReceiptId', 'amount'], raw: true })
      : [];
    const appliedByReceipt = {};
    for (const x of allocs) appliedByReceipt[x.paymentReceiptId] = (appliedByReceipt[x.paymentReceiptId] || 0) + Number(x.amount);

    // ---- Headline numbers ----
    const monthSales = (m) => sum(invoices.filter((i) => monthKey(i.quotationDate) === m), (i) => Number(i.subtotal));
    const open = invoices.map((i) => ({ inv: i, balance: balanceOf(i) })).filter((x) => x.balance >= SETTLED_BELOW);
    const overdue = open.filter((x) => x.inv.validTillDate && x.inv.validTillDate < now);
    const ordersInHand = salesOrders.filter((so) => !hasChild(so, 'invoice'));
    const pipeline = quotations.filter((q) => !hasChild(q, 'sales_order') && q.status !== 'Accepted');
    const fyQuotes = quotations.filter((q) => inFy(q.quotationDate));
    const fyQuotesWon = fyQuotes.filter((q) => hasChild(q, 'sales_order'));
    const fines = await LatePaymentFine.findAll({ where: { userId, status: 'Pending' }, attributes: ['fineAmount', 'gstAmount'], raw: true });

    const kpis = {
      salesFy: sum(fyInvoices, (i) => Number(i.subtotal)),
      salesFyWithGst: sum(fyInvoices, (i) => Number(i.grandTotal)),
      invoicesFy: fyInvoices.length,
      salesThisMonth: monthSales(thisMonth),
      salesLastMonth: monthSales(lastMonth),
      collectedFy: sum(fyReceipts, (r) => Number(r.totalReceived)),
      unappliedFy: sum(fyReceipts, (r) => Math.max(0, Number(r.totalReceived) - (appliedByReceipt[r.id] || 0))),
      receivable: sum(open, (x) => x.balance),
      overdue: sum(overdue, (x) => x.balance),
      overdueInvoices: overdue.length,
      ordersInHand: sum(ordersInHand, (s) => Number(s.grandTotal)),
      ordersInHandCount: ordersInHand.length,
      pipeline: sum(pipeline, (q) => Number(q.grandTotal)),
      pipelineCount: pipeline.length,
      conversionRate: fyQuotes.length ? Math.round((fyQuotesWon.length / fyQuotes.length) * 100) : null,
      quotesFy: fyQuotes.length,
      quotesWonFy: fyQuotesWon.length,
      finesPending: sum(fines, (f) => Number(f.fineAmount) + Number(f.gstAmount || 0)),
    };

    // ---- Monthly invoiced vs collected, Apr..Mar ----
    const monthly = MONTHS.map((label, i) => {
      const y = i < 9 ? fyStart : fyStart + 1;
      const key = `${y}-${String(((i + 3) % 12) + 1).padStart(2, '0')}`;
      return {
        key, label: `${label} ${String(y).slice(2)}`,
        invoiced: sum(invoices.filter((x) => monthKey(x.quotationDate) === key), (x) => Number(x.grandTotal)),
        collected: sum(receipts.filter((r) => monthKey(r.receiptDate) === key), (r) => Number(r.totalReceived)),
        future: key > thisMonth,
      };
    });

    // ---- Funnel for documents dated in the FY ----
    const fySos = salesOrders.filter((s) => inFy(s.quotationDate));
    const fyPaid = fyInvoices.filter((i) => balanceOf(i) < SETTLED_BELOW);
    const funnel = [
      { stage: 'Quotations', count: fyQuotes.length, value: sum(fyQuotes, (q) => Number(q.grandTotal)) },
      { stage: 'Sales Orders', count: fySos.length, value: sum(fySos, (s) => Number(s.grandTotal)) },
      { stage: 'Invoiced', count: fyInvoices.length, value: sum(fyInvoices, (i) => Number(i.grandTotal)) },
      { stage: 'Paid in full', count: fyPaid.length, value: sum(fyPaid, (i) => Number(i.grandTotal)) },
    ];

    // ---- Receivables aging (all open invoices) ----
    const bucket = (d) => (d <= 0 ? 'current' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90p');
    const agingLabels = { current: 'Not yet due', d1_30: '1–30 days', d31_60: '31–60 days', d61_90: '61–90 days', d90p: '90+ days' };
    const aging = Object.keys(agingLabels).map((k) => ({ key: k, label: agingLabels[k], amount: 0, count: 0 }));
    for (const x of open) {
      const b = aging.find((a) => a.key === bucket(x.inv.validTillDate ? daysBetween(x.inv.validTillDate, now) : 0));
      b.amount = round2(b.amount + x.balance); b.count += 1;
    }

    // ---- Top clients and products (FY, before GST) ----
    const byClient = new Map();
    for (const i of fyInvoices) {
      const name = i.client?.businessName || 'No client';
      const c = byClient.get(name) || { name, sales: 0, invoices: 0, owed: 0 };
      c.sales = round2(c.sales + Number(i.subtotal)); c.invoices += 1; c.owed = round2(c.owed + Math.max(0, balanceOf(i)));
      byClient.set(name, c);
    }
    const topClients = [...byClient.values()].sort((a, b) => b.sales - a.sales).slice(0, 5);
    const byProduct = new Map();
    for (const i of fyInvoices) {
      for (const it of Array.isArray(i.items) ? i.items : []) {
        const key = String(it.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (!key) continue;
        const p = byProduct.get(key) || { name: String(it.name).trim(), sales: 0, qty: 0 };
        p.sales = round2(p.sales + (it.amount != null ? Number(it.amount) : Number(it.qty) * Number(it.rate)) || 0);
        p.qty += Number(it.qty) || 0;
        byProduct.set(key, p);
      }
    }
    const topProducts = [...byProduct.values()].sort((a, b) => b.sales - a.sales).slice(0, 5);

    // ---- Needs attention ----
    const attention = {
      overdueInvoices: overdue
        .map((x) => ({ id: x.inv.id, no: x.inv.quotationNo, client: x.inv.client?.businessName || '—', balance: x.balance, dueDate: x.inv.validTillDate, daysOverdue: daysBetween(x.inv.validTillDate, now) }))
        .sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 6),
      deliveries: ordersInHand
        .filter((s) => s.validTillDate && daysBetween(now, s.validTillDate) <= 7)
        .map((s) => ({ id: s.id, no: s.quotationNo, client: s.client?.businessName || '—', value: Number(s.grandTotal), dueDate: s.validTillDate, daysLeft: daysBetween(now, s.validTillDate), poNumber: s.poNumber }))
        .sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 6),
      followUps: pipeline
        .map((q) => ({ id: q.id, no: q.quotationNo, client: q.client?.businessName || '—', value: Number(q.grandTotal), status: q.status, ageDays: daysBetween(q.quotationDate, now) }))
        .filter((q) => q.ageDays >= 7)
        .sort((a, b) => b.ageDays - a.ageDays).slice(0, 6),
      recentPayments: [...receipts]
        .sort((a, b) => (b.receiptDate || '').localeCompare(a.receiptDate || '') || b.id - a.id).slice(0, 6)
        .map((r) => ({ id: r.id, no: r.receiptNo, client: r.client?.businessName || '—', amount: Number(r.totalReceived), date: r.receiptDate, type: r.paymentType })),
    };

    res.json({ success: true, data: { fy: { ...fy, startYear: fyStart, current: fyOf(now) }, asOf: now, kpis, monthly, funnel, aging, topClients, topProducts, attention } });
  } catch (err) {
    console.error('sales dashboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the sales dashboard' });
  }
};
