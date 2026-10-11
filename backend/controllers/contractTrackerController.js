const { QueryTypes } = require('sequelize');
const { sequelize, ContractTracking } = require('../models');
const { resolveActor } = require('../utils/orgActor');
const { toRow, helpers } = require('./contractsController');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');

const { CONTRACT_DT, VALUE, LIST_COLUMNS } = helpers;

// Tracker > Contract Tracker — department-wise follow-up of awarded GeM
// contracts. The stage comes from GeM's own order_status; delivery / invoice
// / payment follow-up is this partner's own record (models/ContractTracking).
// Scope defaults to contracts flagged Meril DB (the ones this business is
// actually fulfilling) plus anything already tracked; "all" widens it to
// every Diagno/Endo contract.

const STAGE_SQL = `CASE
  WHEN c.order_status IN ('Waiting for Seller Confirmation','Order Accepted','Fullfillment in Progress') THEN 'open'
  WHEN c.order_status = 'Waiting for Seller Payment' THEN 'payment'
  WHEN c.order_status IN ('Order Completed','Order Paid') THEN 'completed'
  WHEN c.order_status IN ('Order Cancelled','Cancellation Requested by Buyer') THEN 'cancelled'
  ELSE 'unknown' END`;
const STAGES = ['open', 'payment', 'completed', 'cancelled', 'unknown'];
const FOLLOW_UPS = ['in_progress', 'dispatched', 'delivered', 'invoiced', 'payment_received', 'issue'];
const AGE_DAYS = `DATEDIFF(CURDATE(), ${CONTRACT_DT})`;

// `trackedIds` (this user's few tracked contracts) is looked up first so the
// scope can be `meril_db IN (...) OR id IN (...)` — both indexable — instead
// of testing the LEFT JOIN for NULL, which forced a full-table scan.
function scopeWhere(q, userId, trackedIds) {
  const conds = ["c.dept IN ('diagno','endo')"];
  const r = { userId };
  if (q.scope !== 'all') {
    if (trackedIds.length) { conds.push("(c.meril_db IN ('YES','CONVERTED') OR c.id IN (:trackedIds))"); r.trackedIds = trackedIds; }
    else conds.push("c.meril_db IN ('YES','CONVERTED')");
  }
  return { conds, r };
}

// @route GET /api/contract-tracker?dept=&scope=&stage=&followUp=&zonalHead=&search=&page=&limit=
exports.list = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const from = 'FROM contracts c LEFT JOIN contract_tracking t ON t.contract_id = c.id AND t.user_id = :userId';

    // Stats always cover the whole scope (both departments) so the
    // Diagno / Endo tabs can show their own totals side by side.
    const trackedIds = (await ContractTracking.findAll({ where: { userId }, attributes: ['contractId'], raw: true })).map((t) => t.contractId);
    const base = scopeWhere(req.query, userId, trackedIds);
    const statsRows = await sequelize.query(
      `SELECT c.dept AS dept, ${STAGE_SQL} AS stage, COUNT(*) AS n, COALESCE(SUM(${VALUE}), 0) AS value,
              SUM(CASE WHEN ${STAGE_SQL} IN ('open','payment') AND ${AGE_DAYS} > 30 THEN 1 ELSE 0 END) AS over30,
              SUM(CASE WHEN ${STAGE_SQL} IN ('open','payment') AND ${AGE_DAYS} > 60 THEN 1 ELSE 0 END) AS over60
       ${from} WHERE ${base.conds.join(' AND ')} GROUP BY c.dept, stage`,
      { replacements: base.r, type: QueryTypes.SELECT },
    );
    const blank = () => ({ total: 0, value: 0, over30: 0, over60: 0, stages: Object.fromEntries(STAGES.map((s) => [s, { n: 0, value: 0 }])) });
    const stats = { diagno: blank(), endo: blank() };
    for (const s of statsRows) {
      const d = stats[s.dept]; if (!d) continue;
      d.total += Number(s.n); d.value += Number(s.value); d.over30 += Number(s.over30); d.over60 += Number(s.over60);
      d.stages[s.stage] = { n: Number(s.n), value: Number(s.value) };
    }
    const followRows = await sequelize.query(
      `SELECT t.follow_up AS f, COUNT(*) AS n FROM contract_tracking t JOIN contracts c ON c.id = t.contract_id
       WHERE t.user_id = :userId ${req.query.dept ? 'AND c.dept = :dept' : ''} GROUP BY t.follow_up`,
      { replacements: { userId, dept: (req.query.dept || '').toLowerCase() }, type: QueryTypes.SELECT },
    );
    const followUps = Object.fromEntries(followRows.map((r) => [r.f, Number(r.n)]));

    // Zonal-head workload for the selected department (open + payment-pending).
    const zhWhere = [...base.conds]; const zhRep = { ...base.r };
    if (req.query.dept) { zhWhere.push('c.dept = :dept'); zhRep.dept = req.query.dept.toLowerCase(); }
    const zonalHeads = await sequelize.query(
      `SELECT c.zonal_head AS zh, COUNT(*) AS n, SUM(CASE WHEN ${STAGE_SQL} IN ('open','payment') THEN 1 ELSE 0 END) AS open, COALESCE(SUM(${VALUE}), 0) AS value
       ${from} WHERE ${zhWhere.join(' AND ')} AND c.zonal_head IS NOT NULL AND c.zonal_head <> '' GROUP BY c.zonal_head ORDER BY open DESC, n DESC LIMIT 12`,
      { replacements: zhRep, type: QueryTypes.SELECT },
    );

    // The list itself: scope + dept + stage + follow-up + zonal head + search.
    const conds = [...base.conds]; const rep = { ...base.r };
    if (req.query.dept) { conds.push('c.dept = :dept'); rep.dept = req.query.dept.toLowerCase(); }
    if (req.query.stage && STAGES.includes(req.query.stage)) conds.push(`${STAGE_SQL} = '${req.query.stage}'`);
    if (req.query.followUp === 'none') conds.push('t.id IS NULL');
    else if (FOLLOW_UPS.includes(req.query.followUp)) { conds.push('t.follow_up = :fu'); rep.fu = req.query.followUp; }
    if (req.query.zonalHead) { conds.push('c.zonal_head = :zh'); rep.zh = req.query.zonalHead; }
    if (req.query.search) {
      conds.push('(c.contract_no LIKE :s OR c.hospital_name LIKE :s OR c.seller_name LIKE :s OR c.category_name LIKE :s OR c.product LIKE :s OR t.invoice_no LIKE :s)');
      rep.s = `%${req.query.search}%`;
    }
    const where = conds.join(' AND ');

    const [rows, [{ total }]] = await Promise.all([
      sequelize.query(
        `SELECT ${LIST_COLUMNS}, ${STAGE_SQL} AS stage, ${AGE_DAYS} AS age_days,
                t.id AS t_id, t.follow_up, t.expected_delivery_date, t.delivered_on, t.invoice_no, t.invoice_date,
                t.payment_received_on, t.owner, t.remarks AS t_remarks, t.updated_by, t.updated_at AS t_updated_at, t.history
         ${from} WHERE ${where}
         ORDER BY FIELD(${STAGE_SQL}, 'open','payment','unknown','completed','cancelled'), ${CONTRACT_DT} DESC
         LIMIT :limit OFFSET :offset`,
        { replacements: { ...rep, limit, offset: (page - 1) * limit }, type: QueryTypes.SELECT },
      ),
      sequelize.query(`SELECT COUNT(*) AS total ${from} WHERE ${where}`, { replacements: rep, type: QueryTypes.SELECT }),
    ]);

    const data = rows.map((r) => ({
      ...toRow(r),
      stage: r.stage,
      ageDays: r.age_days == null ? null : Number(r.age_days),
      tracking: r.t_id ? {
        followUp: r.follow_up,
        expectedDeliveryDate: r.expected_delivery_date,
        deliveredOn: r.delivered_on,
        invoiceNo: r.invoice_no,
        invoiceDate: r.invoice_date,
        paymentReceivedOn: r.payment_received_on,
        owner: r.owner,
        remarks: r.t_remarks,
        updatedBy: r.updated_by,
        updatedAt: r.t_updated_at,
        history: typeof r.history === 'string' ? JSON.parse(r.history) : (r.history || []),
      } : null,
    }));

    res.json({ success: true, data, total: Number(total), page, limit, stats, followUps, zonalHeads: zonalHeads.map((z) => ({ zonalHead: z.zh, contracts: Number(z.n), open: Number(z.open), value: Number(z.value) })) });
  } catch (err) {
    console.error('contract tracker list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load contract tracker' });
  }
};

// @route PUT /api/contract-tracker/:contractId
// body: { followUp, expectedDeliveryDate, deliveredOn, invoiceNo, invoiceDate, paymentReceivedOn, owner, remarks }
//   or  { clear: true } to drop back to "not started".
exports.update = async (req, res) => {
  try {
    const contractId = parseInt(req.params.contractId, 10);
    const where = { userId: req.user.id, contractId };
    if (req.body.clear) { await ContractTracking.destroy({ where }); return res.json({ success: true, cleared: true }); }

    const b = req.body;
    if (!FOLLOW_UPS.includes(b.followUp)) return res.status(400).json({ success: false, message: 'Invalid follow-up status' });
    if (b.followUp === 'invoiced' && !b.invoiceNo) return res.status(400).json({ success: false, message: 'Invoice number is required to mark a contract invoiced' });
    if (b.followUp === 'payment_received' && !b.paymentReceivedOn) return res.status(400).json({ success: false, message: 'Payment received date is required' });
    if (b.followUp === 'delivered' && !b.deliveredOn) return res.status(400).json({ success: false, message: 'Delivered date is required' });

    const [exists] = await sequelize.query('SELECT id FROM contracts WHERE id = :id', { replacements: { id: contractId }, type: QueryTypes.SELECT });
    if (!exists) return res.status(404).json({ success: false, message: 'Contract not found' });

    const [row] = await ContractTracking.findOrCreate({ where, defaults: { ...where, followUp: b.followUp } });
    const actor = await resolveActor(req).catch(() => null);
    const by = actor?.actorName || 'Unknown';
    const nz = (v) => (v === '' || v === undefined ? null : v);
    Object.assign(row, {
      followUp: b.followUp,
      expectedDeliveryDate: nz(b.expectedDeliveryDate), deliveredOn: nz(b.deliveredOn),
      invoiceNo: nz(b.invoiceNo), invoiceDate: nz(b.invoiceDate), paymentReceivedOn: nz(b.paymentReceivedOn),
      owner: nz(b.owner), remarks: nz(b.remarks), updatedBy: by,
      history: [...(row.history || []), { at: new Date().toISOString(), by, followUp: b.followUp, note: nz(b.remarks) }],
    });
    await row.save();
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('contract tracker update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update tracking' });
  }
};

const STAGE_LABEL = { open: 'Open', payment: 'Payment pending', completed: 'Completed', cancelled: 'Cancelled', unknown: 'No status' };
const FOLLOW_LABEL = { in_progress: 'In progress', dispatched: 'Dispatched', delivered: 'Delivered', invoiced: 'Invoiced', payment_received: 'Payment received', issue: 'Issue' };

// @route GET /api/contract-tracker/export?mode=all|filtered&scope=&dept=&stage=&followUp=&zonalHead=&search=
// (`scope` — Meril DB contracts vs every contract — is the tracker's own data set, so it applies in both modes.)
exports.exportExcel = safeHandler('contract tracker', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.list, req, { clear: ['dept', 'stage', 'followUp', 'zonalHead', 'search'] });
  await sendWorkbook(res, {
    title: 'Contract Tracker', rows, mode, applied: [['scope', req.query.scope === 'all' ? 'All contracts' : 'Meril DB contracts'], ...applied],
    columns: [
      { header: 'Contract No', key: 'contractNo', width: 24 },
      { header: 'Bid No', key: 'bidNo', width: 22 },
      { header: 'Buying Mode', key: 'buyingMode', width: 12 },
      { header: 'Department', key: 'dept', width: 11 },
      { header: 'Stage', get: (r) => STAGE_LABEL[r.stage] || r.stage, width: 16 },
      { header: 'GeM Status', key: 'status', width: 26 },
      { header: 'Contract Date', key: 'contractDate', width: 17 },
      { header: 'Age (days)', key: 'ageDays', width: 11, type: 'number' },
      { header: 'Zonal Head', key: 'zonalHead', width: 20 },
      { header: 'Buyer / Hospital', key: 'hospitalName', width: 38 },
      { header: 'Buyer State', key: 'hospitalState', width: 16 },
      { header: 'Buyer Location', key: 'hospitalLocation', width: 18 },
      { header: 'Buyer Department', key: 'buyerDepartment', width: 28 },
      { header: 'Buyer Dept / Org', key: 'buyerDeptOrg', width: 28 },
      { header: 'Seller', key: 'sellerName', width: 30 },
      { header: 'Seller State', key: 'sellerState', width: 16 },
      { header: 'Meril DB', key: 'merilDb', width: 10 },
      { header: 'Meril / Others', key: 'merilOthers', width: 12 },
      { header: 'Category', key: 'category', width: 26 },
      { header: 'Product', key: 'product', width: 36 },
      { header: 'Brand', key: 'brand', width: 18 },
      { header: 'Model', key: 'model', width: 18 },
      { header: 'Qty', key: 'orderedQty', width: 9, type: 'number' },
      { header: 'Unit Price', key: 'unitPrice', width: 14, type: 'money' },
      { header: 'Contract Value', key: 'contractValue', width: 16, type: 'money' },
      { header: 'Follow-up', get: (r) => (r.tracking ? FOLLOW_LABEL[r.tracking.followUp] || r.tracking.followUp : 'Not started'), width: 16 },
      { header: 'Expected Delivery', get: (r) => r.tracking && r.tracking.expectedDeliveryDate, width: 16, type: 'date' },
      { header: 'Delivered On', get: (r) => r.tracking && r.tracking.deliveredOn, width: 14, type: 'date' },
      { header: 'Invoice No', get: (r) => r.tracking && r.tracking.invoiceNo, width: 16 },
      { header: 'Invoice Date', get: (r) => r.tracking && r.tracking.invoiceDate, width: 14, type: 'date' },
      { header: 'Payment Received On', get: (r) => r.tracking && r.tracking.paymentReceivedOn, width: 18, type: 'date' },
      { header: 'Owner', get: (r) => r.tracking && r.tracking.owner, width: 16 },
      { header: 'Remarks', get: (r) => r.tracking && r.tracking.remarks, width: 34 },
      { header: 'Last Updated By', get: (r) => r.tracking && r.tracking.updatedBy, width: 18 },
      { header: 'Last Updated', get: (r) => r.tracking && r.tracking.updatedAt, width: 18, type: 'datetime' },
      { header: 'Contract PDF', key: 'pdfLink', width: 30 },
    ],
  });
});
