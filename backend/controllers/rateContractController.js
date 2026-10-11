const { Op } = require('sequelize');
const { RateContract, PartnerDivisionProduct, Client, User, Notification } = require('../models');
const { resolveActor } = require('../utils/orgActor');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');
const { sendMail, isMailConfigured } = require('../utils/mailer');

// Order Management > Rate Contracts (set up) and Tracker > Rate Contract
// Tracker (monitor/alerts) — both read/write the same register, see
// models/RateContract.js. Scoped by userId like every other tracker.

const MILESTONES = [90, 30, 7, 0]; // days-before-expiry reminder points

const nz = (v) => (v === '' || v === undefined ? null : v);
const now = () => new Date();
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
const actorName = async (req) => { try { return (await resolveActor(req))?.actorName || null; } catch (_) { return null; } };

function toRow(r) {
  const j = r.toJSON();
  const daysLeft = daysBetween(today(), j.effectiveTo);
  const expired = j.status !== 'cancelled' && daysLeft < 0;
  const expiringSoon = j.status !== 'cancelled' && !expired && daysLeft <= 30;
  return { ...j, rate: Number(j.rate) || 0, history: j.history || [], notifiedMilestones: j.notifiedMilestones || [], daysLeft, expired, expiringSoon };
}

// @route GET /api/rate-contracts
exports.list = async (req, res) => {
  try {
    const { status, product, client, search } = req.query;
    const where = { userId: req.user.id };
    if (product) where.productId = product;
    if (client) where.clientId = client === 'default' ? null : client;
    if (search) {
      where[Op.or] = [
        { productName: { [Op.like]: `%${search}%` } },
        { clientName: { [Op.like]: `%${search}%` } },
        { contractRef: { [Op.like]: `%${search}%` } },
      ];
    }
    const all = (await RateContract.findAll({ where: { userId: req.user.id }, order: [['effectiveTo', 'ASC']] })).map(toRow);
    const scoped = (product || client || search)
      ? (await RateContract.findAll({ where, order: [['effectiveTo', 'ASC']] })).map(toRow)
      : all;
    const byStatus = {
      active: (r) => r.status === 'active' && !r.expired,
      expiring: (r) => r.expiringSoon,
      expired: (r) => r.expired,
      cancelled: (r) => r.status === 'cancelled',
    };
    const filtered = status && byStatus[status] ? scoped.filter(byStatus[status]) : scoped;

    const stats = {
      total: all.length,
      active: all.filter((r) => r.status === 'active' && !r.expired).length,
      expiringSoon: all.filter((r) => r.expiringSoon).length,
      expired: all.filter((r) => r.expired).length,
      cancelled: all.filter((r) => r.status === 'cancelled').length,
    };
    res.json({ success: true, data: filtered, total: filtered.length, stats });
  } catch (err) {
    console.error('rate contract list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load rate contracts' });
  }
};

// @route GET /api/rate-contracts/active-rate?productId=&productName=&clientId=
// Powers the auto-fill on Quotation/Invoice/Sales Order line items — the
// best-matching CURRENT rate for a product: a client-specific contract if
// one covers today, else the company-wide default (clientId null) one.
exports.getActiveRate = async (req, res) => {
  try {
    const { productId, productName, clientId } = req.query;
    if (!productId && !productName) return res.status(400).json({ success: false, message: 'productId or productName is required' });
    const base = {
      userId: req.user.id, status: 'active',
      effectiveFrom: { [Op.lte]: today() }, effectiveTo: { [Op.gte]: today() },
      ...(productId ? { productId } : { productName }),
    };
    let row = null;
    if (clientId) row = await RateContract.findOne({ where: { ...base, clientId }, order: [['createdAt', 'DESC']] });
    if (!row) row = await RateContract.findOne({ where: { ...base, clientId: null }, order: [['createdAt', 'DESC']] });
    if (!row) return res.json({ success: true, data: null });
    res.json({ success: true, data: { rate: Number(row.rate), currency: row.currency, contractRef: row.contractRef, effectiveTo: row.effectiveTo, clientSpecific: !!row.clientId } });
  } catch (err) {
    console.error('rate contract getActiveRate error:', err);
    res.status(500).json({ success: false, message: 'Failed to look up the rate' });
  }
};

// @route POST /api/rate-contracts
exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.productName || '').trim()) return res.status(400).json({ success: false, message: 'Product is required' });
    if (!(Number(b.rate) >= 0)) return res.status(400).json({ success: false, message: 'Rate must be a positive number' });
    if (!b.effectiveFrom || !b.effectiveTo) return res.status(400).json({ success: false, message: 'Effective from/to dates are required' });
    if (new Date(b.effectiveTo) < new Date(b.effectiveFrom)) return res.status(400).json({ success: false, message: 'Effective-to must be after effective-from' });

    let productId = null; let division = nz(b.division);
    if (b.productId) {
      const p = await PartnerDivisionProduct.findOne({ where: { id: b.productId, userId: req.user.id } });
      if (p) { productId = p.id; division = p.division; }
    }
    let clientName = null;
    if (b.clientId) {
      const c = await Client.findOne({ where: { id: b.clientId, userId: req.user.id } });
      clientName = c?.businessName || null;
    }

    const by = await actorName(req);
    const at = now();
    const row = await RateContract.create({
      userId: req.user.id, productId, productName: b.productName.trim(), division,
      clientId: nz(b.clientId), clientName,
      rate: Number(b.rate), currency: b.currency || 'INR', contractRef: nz(b.contractRef),
      effectiveFrom: b.effectiveFrom, effectiveTo: b.effectiveTo, remarks: nz(b.remarks),
      status: 'active', notifiedMilestones: [], createdByName: by, updatedBy: by,
      history: [{ at: at.toISOString(), by, status: 'active', note: 'Rate contract created' }],
    });
    res.status(201).json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('rate contract create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create rate contract' });
  }
};

const EDITABLE = ['productName', 'division', 'rate', 'currency', 'contractRef', 'effectiveFrom', 'effectiveTo', 'remarks'];

// @route PUT /api/rate-contracts/:id
exports.update = async (req, res) => {
  try {
    const row = await RateContract.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Rate contract not found' });
    const b = req.body || {};
    if (b.rate !== undefined && !(Number(b.rate) >= 0)) return res.status(400).json({ success: false, message: 'Rate must be a positive number' });
    if (b.status !== undefined && !['active', 'cancelled'].includes(b.status)) return res.status(400).json({ success: false, message: 'Invalid status' });

    const by = await actorName(req);
    const at = now();
    const notes = [];
    const history = Array.isArray(row.history) ? [...row.history] : [];

    EDITABLE.forEach((f) => { if (b[f] !== undefined) row[f] = f === 'rate' ? Number(b[f]) : nz(typeof b[f] === 'string' ? b[f].trim() : b[f]); });
    if (b.rate !== undefined) notes.push(`Rate updated to ${row.currency}${Number(b.rate).toLocaleString('en-IN')}`);
    if (b.effectiveTo !== undefined) notes.push(`Validity extended/changed to ${b.effectiveTo}`);
    if (b.status !== undefined && b.status !== row.status) {
      notes.push(`Status changed to "${b.status}"`);
      row.status = b.status;
      if (b.status === 'active') row.notifiedMilestones = []; // renewed/reactivated — reset alert history
    }
    if (b.clientId !== undefined) {
      const c = b.clientId ? await Client.findOne({ where: { id: b.clientId, userId: req.user.id } }) : null;
      row.clientId = nz(b.clientId);
      row.clientName = c?.businessName || null;
      notes.push(`Scope changed to ${c ? c.businessName : 'company-wide default'}`);
    }

    notes.forEach((note) => history.push({ at: at.toISOString(), by, status: row.status, note }));
    row.history = history;
    row.updatedBy = by;
    await row.save();
    res.json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('rate contract update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update rate contract' });
  }
};

// @route DELETE /api/rate-contracts/:id
exports.remove = async (req, res) => {
  try {
    const n = await RateContract.destroy({ where: { id: req.params.id, userId: req.user.id } });
    if (!n) return res.status(404).json({ success: false, message: 'Rate contract not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete rate contract' });
  }
};

// @route GET /api/rate-contracts/export
exports.exportExcel = safeHandler('rate contracts export', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.list, req, { clear: ['status', 'product', 'client', 'search'], paged: false });
  await sendWorkbook(res, {
    title: 'Rate Contracts', filename: 'Rate_Contracts', mode, applied,
    columns: [
      { header: 'Product', key: 'productName', width: 30 },
      { header: 'Division', key: 'division', width: 16 },
      { header: 'Client', get: (r) => r.clientName || 'Company-wide default', width: 26 },
      { header: 'Rate', key: 'rate', width: 14, type: 'money' },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Contract Ref', key: 'contractRef', width: 20 },
      { header: 'Effective From', key: 'effectiveFrom', width: 16, type: 'date' },
      { header: 'Effective To', key: 'effectiveTo', width: 16, type: 'date' },
      { header: 'Days Left', key: 'daysLeft', width: 12, type: 'number' },
      { header: 'Status', get: (r) => (r.status === 'cancelled' ? 'Cancelled' : r.expired ? 'Expired' : 'Active'), width: 14 },
      { header: 'Remarks', key: 'remarks', width: 30 },
    ],
    rows,
  });
});

// ---- expiry check / notifications -------------------------------------

async function notifyOne(row) {
  const daysLeft = daysBetween(today(), row.effectiveTo);
  const milestone = MILESTONES.find((m) => daysLeft <= m);
  if (milestone === undefined) return false;
  const already = row.notifiedMilestones || [];
  if (already.includes(String(milestone))) return false;

  const label = milestone === 0 ? 'has expired' : `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  const title = `Rate contract ${label}: ${row.productName}`;
  const message = `${row.productName}${row.clientName ? ` (for ${row.clientName})` : ' (company-wide default)'} — rate ${row.currency}${Number(row.rate).toLocaleString('en-IN')}, valid till ${row.effectiveTo}.`;

  try { await Notification.create({ userId: row.userId, type: 'rate_contract_expiry', title, message, relatedType: 'rate_contract', relatedId: row.id }); }
  catch (err) { console.error('rate contract notify (bell) error:', err); }

  if (isMailConfigured()) {
    try {
      const owner = await User.findByPk(row.userId, { attributes: ['email', 'name'] });
      if (owner?.email) {
        await sendMail({ to: owner.email, subject: title, html: `<p>Hi ${owner.name || ''},</p><p>${message}</p>` });
      }
    } catch (err) { console.error('rate contract notify (email) error:', err.message); }
  }

  row.notifiedMilestones = [...already, String(milestone)];
  await row.save();
  return true;
}

// Scans unexpired-or-just-expired, non-cancelled rate contracts and fires
// email + in-app alerts for any 90/30/7/0-day milestone not yet notified.
// userId=null scans every organisation (used by the periodic job in
// server.js); a userId scopes it to one org (the Tracker page's manual
// "Check now" button).
async function runExpiryCheck(userId = null) {
  const where = { status: 'active' };
  if (userId) where.userId = userId;
  const rows = await RateContract.findAll({ where });
  let notified = 0;
  for (const row of rows) { if (await notifyOne(row)) notified += 1; }
  return { checked: rows.length, notified };
}
exports.runExpiryCheck = runExpiryCheck;

// @route POST /api/rate-contracts/check-expiries
exports.checkExpiries = async (req, res) => {
  try {
    const result = await runExpiryCheck(req.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('rate contract checkExpiries error:', err);
    res.status(500).json({ success: false, message: 'Failed to check expiries' });
  }
};
