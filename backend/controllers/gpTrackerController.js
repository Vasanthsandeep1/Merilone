const { Op } = require('sequelize');
const { Quotation, Client, Purchase, GpProductCost } = require('../models');
const { round2 } = require('../utils/advances');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');

// Tracker > GP Tracker — gross profit per product:
//   GP = (selling price − cost price) × quantity sold
//
// Selling side: line items of the partner's in-app invoices (not Rejected),
// before GST — GST is collected for the government, not earned.
// Cost side, per product: a cost price the partner typed in on this page
// (GpProductCost) if there is one, otherwise the quantity-weighted average
// item rate across their vendor Purchases (not Rejected), before GST.
// Invoices and purchases hold free-text product names, so products are
// matched on the normalised name (productKey).

const productKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// Pre-GST line value: the stored amount, else qty × rate.
const lineAmount = (it) => (it.amount !== undefined && it.amount !== null ? num(it.amount) : num(it.qty) * num(it.rate));

async function costPrices(userId) {
  const byKey = new Map();
  const purchases = await Purchase.findAll({ where: { userId, source: 'created', status: { [Op.ne]: 'Rejected' } }, attributes: ['items'] });
  for (const p of purchases) {
    for (const it of Array.isArray(p.items) ? p.items : []) {
      const key = productKey(it.name);
      const qty = num(it.qty);
      if (!key || qty <= 0) continue;
      const cur = byKey.get(key) || { qty: 0, amount: 0 };
      cur.qty += qty;
      cur.amount += lineAmount(it);
      byKey.set(key, cur);
    }
  }
  const costs = new Map();
  for (const [key, v] of byKey) costs.set(key, { costPrice: round2(v.amount / v.qty), source: 'purchase', purchasedQty: v.qty });
  const manual = await GpProductCost.findAll({ where: { userId } });
  for (const m of manual) costs.set(m.productKey, { ...(costs.get(m.productKey) || {}), costPrice: Number(m.costPrice), source: 'manual' });
  return costs;
}

// @route GET /api/gp-tracker?search=&clientId=&dateFrom=&dateTo=&costStatus=missing|known
exports.list = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search = '', clientId = '', dateFrom = '', dateTo = '', costStatus = '' } = req.query;
    const where = { userId, docType: 'invoice', source: 'created', status: { [Op.ne]: 'Rejected' } };
    if (clientId) where.clientId = clientId;
    if (dateFrom || dateTo) {
      where.quotationDate = {};
      if (dateFrom) where.quotationDate[Op.gte] = dateFrom;
      if (dateTo) where.quotationDate[Op.lte] = dateTo;
    }
    const invoices = await Quotation.findAll({
      where,
      attributes: ['id', 'quotationNo', 'quotationDate', 'items', 'clientId'],
      include: [{ model: Client, as: 'client', attributes: ['id', 'businessName'] }],
    });
    const costs = await costPrices(userId);

    const products = new Map();
    for (const inv of invoices) {
      for (const it of Array.isArray(inv.items) ? inv.items : []) {
        const key = productKey(it.name);
        if (!key) continue;
        const p = products.get(key) || { productKey: key, productName: String(it.name).trim(), hsn: it.hsn || null, qtySold: 0, revenue: 0, invoices: new Set(), clients: new Set() };
        p.qtySold += num(it.qty);
        p.revenue += lineAmount(it);
        p.invoices.add(inv.quotationNo);
        if (inv.client) p.clients.add(inv.client.businessName);
        products.set(key, p);
      }
    }

    let rows = [...products.values()].map((p) => {
      const c = costs.get(p.productKey);
      const hasCost = !!c && c.costPrice !== undefined;
      const revenue = round2(p.revenue);
      const avgSellPrice = p.qtySold ? round2(p.revenue / p.qtySold) : 0;
      const costOfGoods = hasCost ? round2(c.costPrice * p.qtySold) : null;
      const grossProfit = hasCost ? round2(revenue - costOfGoods) : null;
      return {
        productKey: p.productKey,
        productName: p.productName,
        hsn: p.hsn,
        qtySold: p.qtySold,
        revenue,
        avgSellPrice,
        costPrice: hasCost ? c.costPrice : null,
        costSource: hasCost ? c.source : null,
        costOfGoods,
        grossProfit,
        gpPerUnit: hasCost ? round2(avgSellPrice - c.costPrice) : null,
        gpPercent: hasCost && revenue ? round2((grossProfit / revenue) * 100) : null,
        invoices: [...p.invoices],
        clients: [...p.clients],
      };
    });

    // Totals over the date/client scope, before search and cost filters.
    const known = rows.filter((r) => r.grossProfit !== null);
    const knownRevenue = round2(known.reduce((s, r) => s + r.revenue, 0));
    const totalGp = round2(known.reduce((s, r) => s + r.grossProfit, 0));
    const stats = {
      products: rows.length,
      revenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
      costOfGoods: round2(known.reduce((s, r) => s + r.costOfGoods, 0)),
      grossProfit: totalGp,
      gpPercent: knownRevenue ? round2((totalGp / knownRevenue) * 100) : null,
      missingCost: rows.length - known.length,
      lossMaking: known.filter((r) => r.grossProfit < 0).length,
    };

    const s = search.trim().toLowerCase();
    if (s) rows = rows.filter((r) => r.productKey.includes(s) || (r.hsn || '').toLowerCase().includes(s));
    if (costStatus === 'missing') rows = rows.filter((r) => r.costPrice === null);
    if (costStatus === 'known') rows = rows.filter((r) => r.costPrice !== null);
    if (costStatus === 'loss') rows = rows.filter((r) => r.grossProfit !== null && r.grossProfit < 0);
    // Missing cost first (needs action), then highest profit.
    rows.sort((a, b) => (b.grossProfit === null) - (a.grossProfit === null) || (b.grossProfit ?? b.revenue) - (a.grossProfit ?? a.revenue));

    res.json({ success: true, data: rows, total: rows.length, stats });
  } catch (err) {
    console.error('gp tracker list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load GP tracker' });
  }
};

// @route PUT /api/gp-tracker/cost   { productName, costPrice }  (costPrice null/'' clears it)
exports.setCost = async (req, res) => {
  try {
    const productName = String(req.body.productName || '').trim();
    const key = productKey(productName);
    if (!key) return res.status(400).json({ success: false, message: 'Product name is required' });
    const raw = req.body.costPrice;
    if (raw === null || raw === undefined || raw === '') {
      await GpProductCost.destroy({ where: { userId: req.user.id, productKey: key } });
      return res.json({ success: true, data: null });
    }
    const costPrice = Number(raw);
    if (!Number.isFinite(costPrice) || costPrice < 0) return res.status(400).json({ success: false, message: 'Enter a valid cost price (0 or more)' });
    const [row] = await GpProductCost.upsert({ userId: req.user.id, productKey: key, productName, costPrice: round2(costPrice) });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('gp setCost error:', err);
    res.status(500).json({ success: false, message: 'Failed to save cost price' });
  }
};

// @route GET /api/gp-tracker/export?mode=all|filtered&...filters
exports.exportExcel = safeHandler('gp tracker', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.list, req, { clear: ['search', 'clientId', 'dateFrom', 'dateTo', 'costStatus'], paged: false });
  await sendWorkbook(res, {
    title: 'GP Tracker', rows, mode, applied,
    columns: [
      { header: 'Product', key: 'productName', width: 34 },
      { header: 'HSN', key: 'hsn', width: 10 },
      { header: 'Qty Sold', key: 'qtySold', width: 10, type: 'number' },
      { header: 'Avg Selling Price', key: 'avgSellPrice', width: 16, type: 'money' },
      { header: 'Cost Price', key: 'costPrice', width: 14, type: 'money' },
      { header: 'Cost From', get: (r) => (r.costSource === 'manual' ? 'Entered manually' : r.costSource === 'purchase' ? 'Purchases (avg)' : 'Missing'), width: 16 },
      { header: 'Revenue (excl. GST)', key: 'revenue', width: 18, type: 'money' },
      { header: 'Cost of Goods', key: 'costOfGoods', width: 16, type: 'money' },
      { header: 'Gross Profit', key: 'grossProfit', width: 16, type: 'money' },
      { header: 'GP per Unit', key: 'gpPerUnit', width: 14, type: 'money' },
      { header: 'GP %', key: 'gpPercent', width: 9 },
      { header: 'Invoices', key: 'invoices', width: 30 },
      { header: 'Clients', key: 'clients', width: 30 },
    ],
  });
});

// Shared with the sales incentive (GP% per sales person).
exports.costPrices = costPrices;
