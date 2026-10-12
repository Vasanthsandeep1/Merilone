const { Op } = require('sequelize');
const { Quotation, Client, StaffUser, PartnerProfile, SalesTarget, FlspTarget, Opi } = require('../models');
const { paidByInvoice, round2 } = require('../utils/advances');
const { costPrices } = require('./gpTrackerController');

// Sales incentive: each sales person's target, achievement, GP and AR for a
// financial year, and whether they qualify for the incentive.
//
//   Sales person's sales = the OPIs they created (OPI Management), dated by
//   PO date (else the day it was created) in the FY.
//   Achievement  = those OPIs' order value before GST (Endo: invoice value,
//                  Diagnostics: total before GST).
//   AR still comes from the in-app invoices of the clients assigned to them
//   (clients.sales_staff_id) and their payments — OPIs carry no payment data.
//   Target       = the person's target sheets from Target Management >
//                  Manage Target (flsp_targets, ₹ Lakhs per month) when there
//                  are any, else the single amount on Sales Targets.
//   Achievement% = achievement ÷ target.
//   GP%          = (sales − cost) ÷ sales over the OPI lines that have a cost:
//                  Diagnostics: cost = DB price (Meril's "Cost Per Kit") ×
//                  (qty + free qty), sales = order price × qty.
//                  Endo: sales = Meril billing rate × PO qty, cost = the
//                  product code's cost price in GP Tracker × PO qty.
//   AR days      = what their clients still owe (all invoices, with GST) ÷
//                  FY sales with GST × days gone in the FY  (days of sales
//                  still unpaid; lower is better).
//   Eligible     = GP% > 45 and AR days < 100.
// Logins that look after a team: RSM (sales people) and Zonal Manager (RSMs + sales people).
const MANAGERS = ['rsm', 'zonal_manager'];
const GP_MIN = 45;
const AR_MAX_DAYS = 100;

const fail = (res, code, message) => res.status(code).json({ success: false, message });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const fyOf = (iso) => { const [y, m] = iso.split('-').map(Number); return m >= 4 ? y : y - 1; };
const fyRange = (fy) => ({ from: `${fy}-04-01`, to: `${fy + 1}-03-31` });
const productKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const lineAmount = (it) => (it.amount !== undefined && it.amount !== null ? num(it.amount) : num(it.qty) * num(it.rate));

async function profileOf(ownerUserId) {
  return PartnerProfile.findOne({ where: { userId: ownerUserId } });
}

// Figures for one sales person (staff) in one FY. `costs` is shared across staff.
async function metricsFor(ownerUserId, staff, fy, costs) {
  const { from, to } = fyRange(fy);
  const t = today();
  const clients = await Client.findAll({ where: { userId: ownerUserId, salesStaffId: staff.id }, attributes: ['id', 'businessName'], raw: true });
  const clientIds = clients.map((c) => c.id);
  const target = await SalesTarget.findOne({ where: { staffId: staff.id, fy } });
  const base = { where: { userId: ownerUserId, docType: 'invoice', status: { [Op.ne]: 'Rejected' }, clientId: clientIds.length ? clientIds : -1 } };

  const fyInvoices = await Quotation.findAll({ ...base, where: { ...base.where, quotationDate: { [Op.between]: [from, to] } }, attributes: ['id', 'clientId', 'quotationDate', 'items', 'subtotal', 'grandTotal'] });
  // OPIs = what this person has sold.
  const istDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const allOpis = await Opi.findAll({ where: { staffId: staff.id }, attributes: ['id', 'division', 'customerName', 'poDate', 'createdAt', 'value', 'items'] });
  const fyOpis = allOpis.map((o) => ({ ...o.get({ plain: true }), day: o.poDate || istDay(o.createdAt) })).filter((o) => o.day >= from && o.day <= to);
  const achievement = round2(fyOpis.reduce((s, o) => s + num(o.value), 0));
  const salesWithGst = round2(fyInvoices.reduce((s, i) => s + num(i.grandTotal), 0));

  // GP from the OPI lines (see the rule at the top).
  let costedSales = 0; let cost = 0; let uncostedSales = 0;
  const byProduct = new Map(); // key -> { name, sales, cost, costed }
  for (const o of fyOpis) {
    for (const it of Array.isArray(o.items) ? o.items : []) {
      let amt; let lineCost = null; let name;
      if (o.division === 'diagnostics') {
        amt = num(it.value);
        name = [it.productCode, it.description].filter(Boolean).join(' · ') || 'Unnamed';
        if (it.dbPrice != null && it.dbPrice !== '') lineCost = num(it.dbPrice) * (num(it.qty) + num(it.freeQty));
      } else {
        amt = num(it.invoiceValue);
        name = [it.productCode, it.brandName].filter(Boolean).join(' · ') || 'Unnamed';
        const c = costs.get(productKey(it.productCode));
        if (c && c.costPrice != null) lineCost = num(c.costPrice) * num(it.poQty);
      }
      const key = `${o.division}|${productKey(name)}`;
      const prod = byProduct.get(key) || { name, sales: 0, cost: 0, costed: false };
      prod.sales += amt;
      if (lineCost != null) { costedSales += amt; cost += lineCost; prod.cost += lineCost; prod.costed = true; } else uncostedSales += amt;
      byProduct.set(key, prod);
    }
  }
  // Sales per month of the FY (Apr..Mar), and the even pace to the target.
  const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const monthly = MONTHS.map((label, i) => ({ month: label, year: i < 9 ? fy : fy + 1, sales: 0, endo: 0, diagnostics: 0, opis: 0, cumulative: 0, targetPace: 0, future: false }));
  for (const o of fyOpis) {
    const [y, mo] = String(o.day).split('-').map(Number);
    const idx = (mo + 8) % 12; // Apr -> 0 … Mar -> 11
    if (!monthly[idx] || monthly[idx].year !== y) continue;
    monthly[idx].sales += num(o.value); monthly[idx][o.division] += num(o.value); monthly[idx].opis += 1;
  }
  monthly.forEach((m) => { m.endo = round2(m.endo); m.diagnostics = round2(m.diagnostics); });
  // Target sheets (Manage Target): month-by-month targets in ₹ Lakhs.
  const sheets = await FlspTarget.findAll({ where: { staffId: staff.id, fy }, attributes: ['rows', 'total'] });
  const sheetMonths = new Array(12).fill(0);
  for (const sh of sheets) for (const r of sh.rows || []) (r.months || []).forEach((v, i) => { sheetMonths[i] += num(v) * 1e5; });
  const tgt = sheets.length ? sheetMonths.reduce((a, b) => a + b, 0) : (target ? num(target.targetAmount) : 0);
  let run = 0; let tRun = 0;
  monthly.forEach((m, i) => {
    run += m.sales;
    tRun += sheets.length ? sheetMonths[i] : tgt / 12;
    m.sales = round2(m.sales); m.cumulative = round2(run);
    m.targetMonth = round2(sheets.length ? sheetMonths[i] : tgt / 12);
    m.targetPace = round2(tRun);
    m.future = `${m.year}-${String(((i + 3) % 12) + 1).padStart(2, '0')}-01` > t;
  });
  // Sales per client this FY.
  const nameOf = Object.fromEntries(clients.map((c) => [c.id, c.businessName]));
  const clientSales = {};
  for (const inv of fyInvoices) clientSales[inv.clientId] = (clientSales[inv.clientId] || 0) + num(inv.subtotal);
  const gp = round2(costedSales - cost);
  const gpPct = costedSales > 0 ? round2((gp / costedSales) * 100) : null;

  // Receivable: every unpaid invoice of their clients, whatever its date.
  const allInvoices = await Quotation.findAll({ ...base, attributes: ['id', 'clientId', 'grandTotal', 'quotationDate', 'validTillDate'] });
  const paid = await paidByInvoice(allInvoices.map((i) => i.id));
  const outstanding = round2(allInvoices.reduce((s, i) => s + Math.max(0, num(i.grandTotal) - (paid[i.id] || 0)), 0));
  // What's owed, by how long past the due date (or invoice date when no due date).
  const AGES = [['Not due', -Infinity, 0], ['1–30 days', 1, 30], ['31–60 days', 31, 60], ['61–90 days', 61, 90], ['90+ days', 91, Infinity]];
  const arBuckets = AGES.map(([label]) => ({ label, amount: 0 }));
  const clientOwed = {};
  for (const inv of allInvoices) {
    const bal = Math.max(0, num(inv.grandTotal) - (paid[inv.id] || 0));
    if (bal <= 0.009) continue;
    const due = inv.validTillDate || inv.quotationDate;
    const late = Math.floor((new Date(t) - new Date(due)) / 86400000);
    const i = AGES.findIndex(([, a, b]) => late >= a && late <= b);
    arBuckets[i < 0 ? 0 : i].amount += bal;
    clientOwed[inv.clientId] = (clientOwed[inv.clientId] || 0) + bal;
  }
  arBuckets.forEach((b) => { b.amount = round2(b.amount); });
  const end = t < to ? t : to;
  const daysGone = Math.max(1, Math.floor((new Date(end) - new Date(from)) / 86400000) + 1);
  const arDays = salesWithGst > 0 ? Math.round((outstanding / salesWithGst) * daysGone) : (outstanding > 0 ? null : 0);

  const targetAmount = round2(tgt);
  const reasons = [];
  if (gpPct == null) reasons.push('GP can\'t be worked out yet (no OPI lines with a cost price this year)');
  else if (gpPct <= GP_MIN) reasons.push(`GP is ${gpPct}% (needs more than ${GP_MIN}%)`);
  if (arDays == null) reasons.push('AR can\'t be worked out (money owed but no sales this year)');
  else if (arDays >= AR_MAX_DAYS) reasons.push(`AR is ${arDays} days (needs less than ${AR_MAX_DAYS})`);

  return {
    staff: { id: staff.id, name: staff.name, email: staff.email, status: staff.status },
    fy, fyLabel: `FY ${fy}-${String(fy + 1).slice(2)}`,
    clients, invoices: fyInvoices.length, opis: fyOpis.length,
    // Who they sold to (from the OPIs): hospital / distributor, value, count.
    byCustomer: Object.values(fyOpis.reduce((acc, o) => {
      const k = (o.customerName || 'Unnamed').trim();
      acc[k] = acc[k] || { name: k, value: 0, opis: 0, endo: 0, diagnostics: 0 };
      acc[k].value += num(o.value); acc[k].opis += 1; acc[k][o.division] += num(o.value);
      return acc;
    }, {})).map((c) => ({ ...c, value: round2(c.value), endo: round2(c.endo), diagnostics: round2(c.diagnostics) })).sort((a, b) => b.value - a.value).slice(0, 10),
    byDivision: { endo: round2(fyOpis.filter((o) => o.division === 'endo').reduce((s, o) => s + num(o.value), 0)), diagnostics: round2(fyOpis.filter((o) => o.division === 'diagnostics').reduce((s, o) => s + num(o.value), 0)) },
    target: targetAmount,
    targetSource: sheets.length ? 'sheet' : target ? 'amount' : null,
    achievement,
    achievementPct: targetAmount > 0 ? round2((achievement / targetAmount) * 100) : null,
    gp, gpPct, uncostedSales: round2(uncostedSales),
    monthly,
    products: [...byProduct.values()].map((p) => ({ name: p.name, sales: round2(p.sales), gp: p.costed ? round2(p.sales - p.cost) : null, gpPct: p.costed && p.sales > 0 ? round2(((p.sales - p.cost) / p.sales) * 100) : null }))
      .sort((a, b) => b.sales - a.sales).slice(0, 8),
    byClient: clients.map((c) => ({ id: c.id, name: nameOf[c.id], sales: round2(clientSales[c.id] || 0), owed: round2(clientOwed[c.id] || 0) }))
      .sort((a, b) => b.sales - a.sales),
    arBuckets,
    outstanding, arDays, daysGone, salesWithGst,
    rules: { gpMin: GP_MIN, arMaxDays: AR_MAX_DAYS },
    eligible: reasons.length === 0,
    reasons,
  };
}

// @route GET /api/sales-incentive/me?fy=2026  (sales staff login)
// The Master Admin viewing the Sales dashboard passes ?staffId= to see one
// of their sales people (see /people for the list).
exports.me = async (req, res) => {
  try {
    let staff;
    // An RSM / Zonal Manager opening a team member's dashboard (My Team):
    // an RSM sees Sales / FLSP people; a Zonal Manager also sees RSMs.
    if (req.user.staffId && MANAGERS.includes(req.user.staffRole) && req.query.staffId && Number(req.query.staffId) !== req.user.staffId) {
      staff = await ownStaff(req, Number(req.query.staffId));
      const viewable = req.user.staffRole === 'zonal_manager' ? ['sales', 'flsp', 'rsm'] : ['sales', 'flsp'];
      if (staff && !viewable.includes(staff.role)) staff = null;
    } else if (req.user.staffId) staff = await StaffUser.findByPk(req.user.staffId);
    else {
      if (!req.query.staffId) return fail(res, 400, 'Choose a sales person to view');
      staff = await ownStaff(req, Number(req.query.staffId));
    }
    if (!staff) return fail(res, 404, 'Sales account not found');
    const fy = Number(req.query.fy) || fyOf(today());
    const costs = await costPrices(req.user.id);
    res.json({ success: true, data: await metricsFor(req.user.id, staff, fy, costs) });
  } catch (err) {
    console.error('sales incentive me error:', err);
    fail(res, 500, 'Could not load your target');
  }
};

// For the B2G Assistant: this sales login's figures (null when the request
// isn't from a sales / FLSP login).
exports.metricsForRequest = async (req, fy = fyOf(today())) => {
  if (!req.user?.staffId) return null;
  const staff = await StaffUser.findByPk(req.user.staffId);
  if (!staff || !['sales', 'flsp', 'rsm', 'zonal_manager'].includes(staff.role)) return null;
  return metricsFor(req.user.id, staff, fy, await costPrices(req.user.id));
};

// @route GET /api/sales-incentive/people  (Master Admin): sales people to view as
exports.people = async (req, res) => {
  try {
    if (req.user.staffId) return fail(res, 403, 'Only the organisation admin can view other sales people');
    const profile = await profileOf(req.user.id);
    const rows = profile ? await StaffUser.findAll({ where: { partnerProfileId: profile.id, role: 'sales', status: { [Op.ne]: 'rejected' } }, attributes: ['id', 'name', 'email'], order: [['name', 'ASC']] }) : [];
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('sales incentive people error:', err);
    fail(res, 500, 'Could not load sales people');
  }
};

// @route GET /api/sales-incentive/team?fy=2026  (org admin): every sales person
exports.team = async (req, res) => {
  try {
    // The Master Admin, or an RSM (read-only team view on their dashboard).
    if (req.user.staffId && !MANAGERS.includes(req.user.staffRole)) return fail(res, 403, 'Only the organisation admin, an RSM or a Zonal Manager can see the team');
    const profile = await profileOf(req.user.id);
    if (!profile) return res.json({ success: true, data: [], clients: [] });
    const fy = Number(req.query.fy) || fyOf(today());
    // Sales / FLSP people, plus RSMs for the Zonal Manager and the admin (an RSM's list stays sales people only).
    const roles = req.user.staffRole === 'rsm' ? ['sales', 'flsp'] : ['sales', 'flsp', 'rsm'];
    const staff = await StaffUser.findAll({ where: { partnerProfileId: profile.id, role: roles, status: { [Op.ne]: 'rejected' } }, order: [['name', 'ASC']] });
    const costs = await costPrices(req.user.id);
    const data = [];
    for (const s of staff) {
      const m = await metricsFor(req.user.id, s, fy, costs);
      // Their RSM / Zonal Head, from their target sheet (Manage Target).
      const sheet = await FlspTarget.findOne({ where: { staffId: s.id, fy }, order: [['updatedAt', 'DESC']], attributes: ['rsm', 'zonalHead'] });
      data.push({ ...m, role: s.role, rsm: sheet?.rsm || null, zonalHead: sheet?.zonalHead || null });
    }
    const clients = await Client.findAll({ where: { userId: req.user.id, status: 'Active' }, attributes: ['id', 'businessName', 'salesStaffId'], order: [['businessName', 'ASC']], raw: true });
    res.json({ success: true, fy, data, clients });
  } catch (err) {
    console.error('sales incentive team error:', err);
    fail(res, 500, 'Could not load sales targets');
  }
};

async function ownStaff(req, staffId) {
  const profile = await profileOf(req.user.id);
  return profile ? StaffUser.findOne({ where: { id: staffId, partnerProfileId: profile.id, role: ['sales', 'flsp', 'rsm', 'zonal_manager'] } }) : null;
}

// @route PUT /api/sales-incentive/target  { staffId, fy, target }  (org admin)
exports.setTarget = async (req, res) => {
  try {
    if (req.user.staffId) return fail(res, 403, 'Only the organisation admin can set targets');
    const staff = await ownStaff(req, Number(req.body.staffId));
    if (!staff) return fail(res, 404, 'Sales person not found');
    const fy = Number(req.body.fy);
    const target = Number(req.body.target);
    if (!(fy >= 2000 && fy <= 2100)) return fail(res, 400, 'Choose a financial year');
    if (!(target >= 0)) return fail(res, 400, 'Enter a valid target');
    const [row] = await SalesTarget.findOrCreate({ where: { staffId: staff.id, fy }, defaults: { userId: req.user.id, targetAmount: target } });
    await row.update({ targetAmount: target });
    res.json({ success: true });
  } catch (err) {
    console.error('sales incentive setTarget error:', err);
    fail(res, 500, 'Could not save the target');
  }
};

// @route PUT /api/sales-incentive/clients  { staffId, clientIds }  (org admin)
// The clients this sales person handles (replaces their list).
exports.setClients = async (req, res) => {
  try {
    if (req.user.staffId) return fail(res, 403, 'Only the organisation admin can assign clients');
    const staff = await ownStaff(req, Number(req.body.staffId));
    if (!staff) return fail(res, 404, 'Sales person not found');
    const ids = (Array.isArray(req.body.clientIds) ? req.body.clientIds : []).map(Number).filter(Boolean);
    await Client.update({ salesStaffId: null }, { where: { userId: req.user.id, salesStaffId: staff.id } });
    if (ids.length) await Client.update({ salesStaffId: staff.id }, { where: { userId: req.user.id, id: ids } });
    res.json({ success: true });
  } catch (err) {
    console.error('sales incentive setClients error:', err);
    fail(res, 500, 'Could not save the clients');
  }
};
