const { Op, QueryTypes } = require('sequelize');
const { sequelize, Quotation, Client, LdRecord } = require('../models');
const { round2 } = require('../utils/advances');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');

// Tracker > LD Tracker — Liquidated Damages: the penalty WE pay the buyer
// when we deliver after the contract delivery date. The rate comes from the
// tender document (typically 0.3%–1% of the delayed value per week of delay,
// capped — GeM's standard is 0.5% per week, max 10%).
//
//   LD = base value × LD% × periods late      (capped at base value × cap%)
//   periods late = ceil(days late / 7) per week, or days late per day
//
// Orders come from two places:
//   sales_order — our Sales Orders; due = the SO delivery date
//   gem_order   — GeM contracts followed in the Contract Tracker
//                 (contract_tracking); due = its expected delivery date,
//                 delivered = its delivered-on date
// Per-order LD terms/outcome live in LdRecord (defaults below until edited).

const DEFAULTS = { ldPercent: 0.5, ldBasis: 'week', ldCapPercent: 10 };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const daysBetween = (from, to) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);

function computeLd({ baseValue, dueDate, deliveredAt, ldPercent, ldBasis, ldCapPercent }, now) {
  if (!dueDate) return { state: 'no_due_date', daysLate: 0, daysLeft: null, periods: 0, ldAmount: 0, capAmount: 0, capped: false };
  const end = deliveredAt || now;
  const daysLate = Math.max(0, daysBetween(dueDate, end));
  const periods = ldBasis === 'day' ? daysLate : Math.ceil(daysLate / 7);
  const capAmount = round2((baseValue * ldCapPercent) / 100);
  const raw = round2((baseValue * ldPercent * periods) / 100);
  const ldAmount = Math.min(raw, capAmount);
  let state;
  if (deliveredAt) state = daysLate > 0 ? 'delivered_late' : 'delivered_on_time';
  else if (daysLate > 0) state = 'running_late';
  else state = daysBetween(now, dueDate) <= 7 ? 'due_soon' : 'on_track';
  return {
    state, daysLate, periods, ldAmount, capAmount, capped: raw > capAmount,
    daysLeft: deliveredAt ? null : daysBetween(now, dueDate),
  };
}

// GeM contracts this user follows in the Contract Tracker, minus cancelled
// orders (no delivery, so no LD).
async function gemOrders(req) {
  const rows = await sequelize.query(
    `SELECT c.id, c.contract_no, c.bid_no, c.contract_dt, c.hospital_name, c.organization_name, c.buyer_department,
            c.value_num, c.total_value, t.expected_delivery_date, t.delivered_on
     FROM contract_tracking t JOIN contracts c ON c.id = t.contract_id
     WHERE t.user_id = :userId
       AND (c.order_status IS NULL OR c.order_status NOT IN ('Order Cancelled', 'Cancellation Requested by Buyer'))`,
    { replacements: { userId: req.user.id }, type: QueryTypes.SELECT },
  );
  return rows.map((c) => ({
    id: c.id,
    orderNo: c.contract_no || c.bid_no || `GeM contract #${c.id}`,
    date: c.contract_dt,
    buyer: c.hospital_name || c.organization_name || c.buyer_department || null,
    value: Number(c.value_num) || parseFloat(String(c.total_value ?? '').replace(/,/g, '')) || 0,
    expectedDelivery: c.expected_delivery_date,
    deliveredAt: c.delivered_on,
  }));
}

// @route GET /api/ld-tracker?search=&source=&state=&status=
exports.list = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search = '', source = '', state = '', status = '' } = req.query;
    const now = today();

    const [salesOrders, gem, records] = await Promise.all([
      Quotation.findAll({
        where: { userId, docType: 'sales_order', status: { [Op.ne]: 'Rejected' } },
        attributes: ['id', 'quotationNo', 'quotationDate', 'validTillDate', 'grandTotal', 'poNumber', 'poDate'],
        include: [{ model: Client, as: 'client', attributes: ['id', 'businessName'] }],
      }),
      gemOrders(req).catch((err) => { console.error('ld tracker: gem orders failed:', err.message); return []; }),
      LdRecord.findAll({ where: { userId } }),
    ]);
    const recordFor = new Map(records.map((r) => [`${r.source}:${r.sourceId}`, r.toJSON()]));

    const base = [
      ...salesOrders.map((so) => ({
        source: 'sales_order', sourceId: so.id,
        orderNo: so.quotationNo, orderDate: so.quotationDate,
        customer: so.client?.businessName || '—', poNumber: so.poNumber,
        orderValue: Number(so.grandTotal), sourceDueDate: so.validTillDate, sourceDeliveredAt: null,
      })),
      ...gem.map((o) => ({
        source: 'gem_order', sourceId: o.id,
        orderNo: o.orderNo, orderDate: o.date,
        customer: o.buyer || '—', poNumber: null,
        orderValue: Number(o.value) || 0, sourceDueDate: o.expectedDelivery, sourceDeliveredAt: o.deliveredAt,
      })),
    ];

    let rows = base.map((b) => {
      const r = recordFor.get(`${b.source}:${b.sourceId}`) || {};
      const terms = {
        ldPercent: r.ldPercent != null ? Number(r.ldPercent) : DEFAULTS.ldPercent,
        ldBasis: r.ldBasis || DEFAULTS.ldBasis,
        ldCapPercent: r.ldCapPercent != null ? Number(r.ldCapPercent) : DEFAULTS.ldCapPercent,
      };
      const baseValue = r.baseValue != null ? Number(r.baseValue) : b.orderValue;
      const dueDate = r.dueDate || b.sourceDueDate || null;
      const deliveredAt = r.deliveredAt || b.sourceDeliveredAt || null;
      const calc = computeLd({ baseValue, dueDate, deliveredAt, ...terms }, now);
      return {
        ...b,
        key: `${b.source}:${b.sourceId}`,
        ...terms,
        termsSet: !!r.id,
        baseValue,
        baseValueOverridden: r.baseValue != null,
        dueDate,
        deliveredAt,
        ...calc,
        status: r.status || 'open',
        deductedAmount: r.deductedAmount != null ? Number(r.deductedAmount) : null,
        remarks: r.remarks || null,
      };
    });

    // Liability = LD still to be settled (not yet deducted, not waived).
    const late = rows.filter((r) => r.ldAmount > 0);
    const sum = (list, f) => round2(list.reduce((s, r) => s + f(r), 0));
    const stats = {
      orders: rows.length,
      lateOrders: late.length,
      runningLate: rows.filter((r) => r.state === 'running_late').length,
      dueSoon: rows.filter((r) => r.state === 'due_soon').length,
      liability: sum(late.filter((r) => ['open', 'waiver_requested'].includes(r.status)), (r) => r.ldAmount),
      deducted: sum(rows.filter((r) => r.status === 'deducted'), (r) => (r.deductedAmount ?? r.ldAmount)),
      waived: sum(late.filter((r) => r.status === 'waived'), (r) => r.ldAmount),
      waiverRequested: rows.filter((r) => r.status === 'waiver_requested').length,
      noDueDate: rows.filter((r) => r.state === 'no_due_date').length,
    };

    const s = search.trim().toLowerCase();
    if (s) rows = rows.filter((r) => [r.orderNo, r.customer, r.poNumber].some((v) => (v || '').toLowerCase().includes(s)));
    if (source) rows = rows.filter((r) => r.source === source);
    if (state === 'late') rows = rows.filter((r) => r.ldAmount > 0);
    else if (state) rows = rows.filter((r) => r.state === state);
    if (status) rows = rows.filter((r) => r.status === status);

    // Needs attention first: running late, then due soon, then delivered late, then the rest.
    const rank = { running_late: 0, due_soon: 1, delivered_late: 2, on_track: 3, no_due_date: 4, delivered_on_time: 5 };
    rows.sort((a, b) => rank[a.state] - rank[b.state] || b.ldAmount - a.ldAmount || (a.dueDate || '').localeCompare(b.dueDate || ''));

    res.json({ success: true, data: rows, total: rows.length, stats, defaults: DEFAULTS });
  } catch (err) {
    console.error('ld tracker list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load LD tracker' });
  }
};

// @route PUT /api/ld-tracker/:source/:sourceId
// body: { ldPercent, ldBasis, ldCapPercent, baseValue, dueDate, deliveredAt, status, deductedAmount, remarks }
exports.update = async (req, res) => {
  try {
    const { source } = req.params;
    const sourceId = parseInt(req.params.sourceId, 10);
    if (!['sales_order', 'gem_order'].includes(source) || !sourceId) return res.status(400).json({ success: false, message: 'Unknown order' });
    const b = req.body || {};
    const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    const date = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

    const ldPercent = num(b.ldPercent);
    const ldCapPercent = num(b.ldCapPercent);
    if (ldPercent === null || !(ldPercent >= 0) || ldPercent > 100) return res.status(400).json({ success: false, message: 'Enter the LD rate as a percentage (e.g. 0.5)' });
    if (ldCapPercent === null || !(ldCapPercent >= 0) || ldCapPercent > 100) return res.status(400).json({ success: false, message: 'Enter the maximum LD cap as a percentage (e.g. 10)' });
    if (!['week', 'day'].includes(b.ldBasis)) return res.status(400).json({ success: false, message: 'Choose per week or per day' });
    const baseValue = num(b.baseValue);
    if (baseValue !== null && !(baseValue >= 0)) return res.status(400).json({ success: false, message: 'Enter a valid value for LD' });
    const status = ['open', 'deducted', 'waiver_requested', 'waived'].includes(b.status) ? b.status : 'open';
    const deductedAmount = num(b.deductedAmount);
    if (deductedAmount !== null && !(deductedAmount >= 0)) return res.status(400).json({ success: false, message: 'Enter a valid deducted amount' });

    // The order must be one of this user's.
    if (source === 'sales_order') {
      const so = await Quotation.findOne({ where: { id: sourceId, userId: req.user.id, docType: 'sales_order' }, attributes: ['id'] });
      if (!so) return res.status(404).json({ success: false, message: 'Order not found' });
    } else {
      const gem = await gemOrders(req);
      if (!gem.some((o) => o.id === sourceId)) return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const [row] = await LdRecord.findOrCreate({ where: { userId: req.user.id, source, sourceId }, defaults: { userId: req.user.id, source, sourceId } });
    Object.assign(row, {
      ldPercent, ldBasis: b.ldBasis, ldCapPercent, baseValue,
      dueDate: date(b.dueDate), deliveredAt: date(b.deliveredAt),
      status, deductedAmount: status === 'deducted' ? deductedAmount : null,
      remarks: (b.remarks || '').trim() || null,
    });
    await row.save();
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('ld tracker update error:', err);
    res.status(500).json({ success: false, message: 'Failed to save LD details' });
  }
};

const STATE_LABEL = {
  running_late: 'Running late', due_soon: 'Due within 7 days', on_track: 'On track',
  delivered_late: 'Delivered late', delivered_on_time: 'Delivered on time', no_due_date: 'No delivery date',
};
const STATUS_LABEL = { open: 'Payable', deducted: 'Deducted by buyer', waiver_requested: 'Waiver requested', waived: 'Waived' };

// @route GET /api/ld-tracker/export?mode=all|filtered&...filters
exports.exportExcel = safeHandler('ld tracker', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.list, req, { clear: ['search', 'source', 'state', 'status'], paged: false });
  await sendWorkbook(res, {
    title: 'LD Tracker', rows, mode, applied,
    columns: [
      { header: 'Order', key: 'orderNo', width: 26 },
      { header: 'Type', get: (r) => (r.source === 'sales_order' ? 'Sales Order' : 'GeM order'), width: 12 },
      { header: 'Customer', key: 'customer', width: 32 },
      { header: 'Customer PO', key: 'poNumber', width: 18 },
      { header: 'Order Value', key: 'orderValue', width: 15, type: 'money' },
      { header: 'LD Base Value', key: 'baseValue', width: 15, type: 'money' },
      { header: 'Delivery Due', key: 'dueDate', width: 13, type: 'date' },
      { header: 'Delivered On', key: 'deliveredAt', width: 13, type: 'date' },
      { header: 'Delivery', get: (r) => STATE_LABEL[r.state], width: 18 },
      { header: 'Days Late', key: 'daysLate', width: 10, type: 'number' },
      { header: 'LD Rate', get: (r) => `${r.ldPercent}% per ${r.ldBasis}`, width: 14 },
      { header: 'Max Cap %', key: 'ldCapPercent', width: 10 },
      { header: 'LD Amount', key: 'ldAmount', width: 14, type: 'money' },
      { header: 'Capped', get: (r) => (r.capped ? 'Yes' : ''), width: 8 },
      { header: 'LD Status', get: (r) => STATUS_LABEL[r.status], width: 18 },
      { header: 'Deducted Amount', key: 'deductedAmount', width: 15, type: 'money' },
      { header: 'Remarks', key: 'remarks', width: 36 },
    ],
  });
});
