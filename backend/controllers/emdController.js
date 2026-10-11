const { EmdRecord, GemTender } = require('../models');
const { resolveActor } = require('../utils/orgActor');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');
const { helpers } = require('./tenderController');
const { fromUrlId } = helpers;

// Workdesk > EMD Management — the register of earnest-money deposits (EMD) and
// performance bank guarantees (PBG). The tender's own EMD amount is looked up
// from the tender data; everything after that (instrument, bank, validity,
// refund state) is recorded by the team.

const TYPES = ['emd', 'pbg'];
const INSTRUMENTS = ['dd', 'bg', 'online', 'fdr', 'exempt', 'other'];
const STATUSES = ['requested', 'submitted', 'refund_due', 'refunded', 'forfeited'];
// Money that is currently tied up with the buyer.
const LOCKED = ['submitted', 'refund_due'];

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0; };
const nz = (v) => (v === '' || v === undefined ? null : v);
const actorName = async (req) => { try { return (await resolveActor(req))?.actorName || null; } catch (_) { return null; } };

function toRow(r) {
  const j = r.toJSON();
  const locked = LOCKED.includes(j.status);
  return {
    ...j,
    amount: Number(j.amount) || 0,
    urlId: j.bidNumber ? j.bidNumber.split('/').join('_') : null,
    history: Array.isArray(j.history) ? j.history : [],
    locked,
    // validity has run out while the money is still with the buyer
    lapsed: !!(locked && j.validUntil && j.validUntil < today()),
    expiringSoon: !!(locked && j.validUntil && j.validUntil >= today() && j.validUntil <= inDays(30)),
    refundOverdue: !!((j.status === 'submitted' || j.status === 'refund_due') && j.refundDueOn && j.refundDueOn < today()),
  };
}

// @route GET /api/emd?type=&status=&dept=&instrument=&flag=&search=&page=&limit=
exports.list = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const all = (await EmdRecord.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] })).map(toRow);

    const sum = (list) => list.reduce((s, r) => s + r.amount, 0);
    const byStatus = (s) => all.filter((r) => r.status === s);
    const stats = {
      total: all.length,
      emd: all.filter((r) => r.type === 'emd').length,
      pbg: all.filter((r) => r.type === 'pbg').length,
      requested: byStatus('requested').length,
      submitted: byStatus('submitted').length,
      refund_due: byStatus('refund_due').length,
      refunded: byStatus('refunded').length,
      forfeited: byStatus('forfeited').length,
      lockedAmount: sum(all.filter((r) => r.locked)),
      submittedAmount: sum(byStatus('submitted')),
      emdLockedAmount: sum(all.filter((r) => r.locked && r.type === 'emd')),
      pbgLockedAmount: sum(all.filter((r) => r.locked && r.type === 'pbg')),
      refundDueAmount: sum(byStatus('refund_due')),
      refundedAmount: sum(byStatus('refunded')),
      forfeitedAmount: sum(byStatus('forfeited')),
      expiringSoon: all.filter((r) => r.expiringSoon).length,
      lapsed: all.filter((r) => r.lapsed).length,
      refundOverdue: all.filter((r) => r.refundOverdue).length,
    };

    const { type, status, dept, instrument, flag, search } = req.query;
    let rows = all;
    if (TYPES.includes(type)) rows = rows.filter((r) => r.type === type);
    if (STATUSES.includes(status)) rows = rows.filter((r) => r.status === status);
    if (dept === 'diagno' || dept === 'endo') rows = rows.filter((r) => (r.dept || '').toLowerCase() === dept);
    if (INSTRUMENTS.includes(instrument)) rows = rows.filter((r) => r.instrument === instrument);
    if (flag === 'expiring') rows = rows.filter((r) => r.expiringSoon);
    else if (flag === 'lapsed') rows = rows.filter((r) => r.lapsed);
    else if (flag === 'refund_overdue') rows = rows.filter((r) => r.refundOverdue);
    else if (flag === 'locked') rows = rows.filter((r) => r.locked);
    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter((r) => [r.reference, r.bidNumber, r.title, r.buyer, r.bank, r.instrumentNo, r.owner, r.remarks].some((v) => v && String(v).toLowerCase().includes(q)));
    }

    // Needs attention first: lapsed / refund overdue / expiring, then by newest.
    const rank = (r) => (r.lapsed || r.refundOverdue ? 0 : r.expiringSoon ? 1 : r.status === 'refund_due' ? 2 : r.locked ? 3 : r.status === 'requested' ? 4 : 5);
    rows = rows.slice().sort((a, b) => rank(a) - rank(b));

    res.json({ success: true, data: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit, stats });
  } catch (err) {
    console.error('emd list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load EMD register' });
  }
};

// @route GET /api/emd/tender-lookup?bid=GEM_2026_B_123  — what the tender data already knows
exports.tenderLookup = async (req, res) => {
  try {
    const bid = fromUrlId(String(req.query.bid || ''));
    if (!bid) return res.json({ success: true, data: null });
    const t = await GemTender.findOne({ where: { bidNumber: bid }, attributes: ['bidNumber', 'items', 'department', 'dept', 'emdAmount', 'endDate'], raw: true });
    if (!t) return res.json({ success: true, data: null });
    res.json({ success: true, data: { bidNumber: t.bidNumber, title: t.items || '', buyer: t.department || '', dept: (t.dept || '').toLowerCase(), amount: num(t.emdAmount), closingDate: t.endDate || null } });
  } catch (err) {
    console.error('emd tender lookup error:', err);
    res.status(500).json({ success: false, message: 'Failed to look up the tender' });
  }
};

function validate(b, isCreate) {
  if (isCreate || b.type !== undefined) if (!TYPES.includes(b.type)) return 'Type must be EMD or PBG';
  if (isCreate && !String(b.reference || '').trim()) return 'Tender / contract reference is required';
  if (b.instrument !== undefined && !INSTRUMENTS.includes(b.instrument)) return 'Invalid instrument';
  if (b.status !== undefined && !STATUSES.includes(b.status)) return 'Invalid status';
  if (b.amount !== undefined && !(num(b.amount) >= 0)) return 'Amount must be a positive number';
  if ((b.status === 'refunded') && !b.refundedOn) return 'Refunded date is required to mark it refunded';
  if ((b.instrument === 'bg' || b.instrument === 'fdr') && b.status === 'submitted' && !b.validUntil) return 'Valid-until date is required for a BG / FDR';
  return null;
}

const FIELDS = ['type', 'reference', 'bidNumber', 'title', 'buyer', 'dept', 'instrument', 'instrumentNo', 'bank', 'issuedOn', 'validUntil', 'status', 'refundDueOn', 'refundedOn', 'owner', 'remarks'];

// @route POST /api/emd
exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    const bad = validate({ type: 'emd', ...b }, true);
    if (bad) return res.status(400).json({ success: false, message: bad });
    const by = (await actorName(req)) || 'Unknown';
    const data = { userId: req.user.id, amount: num(b.amount), createdByName: by, updatedBy: by, history: [{ at: new Date().toISOString(), by, status: b.status || 'requested', note: 'Record created' }] };
    for (const f of FIELDS) if (b[f] !== undefined) data[f] = f === 'bidNumber' ? nz(fromUrlId(b[f] || '')) : nz(typeof b[f] === 'string' ? b[f].trim() : b[f]);
    data.type = TYPES.includes(b.type) ? b.type : 'emd';
    const row = await EmdRecord.create(data);
    res.status(201).json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('emd create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create record' });
  }
};

// @route PUT /api/emd/:id
exports.update = async (req, res) => {
  try {
    const row = await EmdRecord.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Record not found' });
    const b = req.body || {};
    const merged = { ...row.toJSON(), ...b };
    const bad = validate(merged, false);
    if (bad) return res.status(400).json({ success: false, message: bad });

    const by = (await actorName(req)) || 'Unknown';
    const before = row.status;
    for (const f of FIELDS) if (b[f] !== undefined) row[f] = f === 'bidNumber' ? nz(fromUrlId(b[f] || '')) : nz(typeof b[f] === 'string' ? b[f].trim() : b[f]);
    if (b.amount !== undefined) row.amount = num(b.amount);
    row.updatedBy = by;
    const note = before !== row.status ? `Status: ${before} → ${row.status}${b.note ? ` · ${b.note}` : ''}` : (b.note || 'Details updated');
    row.history = [...(row.history || []), { at: new Date().toISOString(), by, status: row.status, note }];
    await row.save();
    res.json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('emd update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update record' });
  }
};

// @route DELETE /api/emd/:id
exports.remove = async (req, res) => {
  try {
    const n = await EmdRecord.destroy({ where: { id: req.params.id, userId: req.user.id } });
    if (!n) return res.status(404).json({ success: false, message: 'Record not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('emd delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete record' });
  }
};

const LABELS = {
  type: { emd: 'EMD', pbg: 'PBG' },
  instrument: { dd: 'Demand Draft', bg: 'Bank Guarantee', online: 'Online / NEFT', fdr: 'FDR', exempt: 'Exempted', other: 'Other' },
  status: { requested: 'Requested', submitted: 'Submitted', refund_due: 'Refund due', refunded: 'Refunded', forfeited: 'Forfeited' },
};

// @route GET /api/emd/export?mode=all|filtered&type=&status=&dept=&instrument=&flag=&search=
exports.exportExcel = safeHandler('emd register', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.list, req, { clear: ['type', 'status', 'dept', 'instrument', 'flag', 'search'] });
  await sendWorkbook(res, {
    title: 'EMD Management', rows, mode, applied,
    columns: [
      { header: 'Type', get: (r) => LABELS.type[r.type], width: 8 },
      { header: 'Tender / Contract Ref', key: 'reference', width: 26 },
      { header: 'Bid Number', key: 'bidNumber', width: 24 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Buyer', key: 'buyer', width: 34 },
      { header: 'Department', key: 'dept', width: 11 },
      { header: 'Amount', key: 'amount', width: 15, type: 'money' },
      { header: 'Instrument', get: (r) => LABELS.instrument[r.instrument], width: 16 },
      { header: 'Instrument No', key: 'instrumentNo', width: 20 },
      { header: 'Bank', key: 'bank', width: 24 },
      { header: 'Issued On', key: 'issuedOn', width: 13, type: 'date' },
      { header: 'Valid Until', key: 'validUntil', width: 13, type: 'date' },
      { header: 'Status', get: (r) => LABELS.status[r.status], width: 13 },
      { header: 'Money Locked', get: (r) => (r.locked ? 'Yes' : 'No'), width: 12 },
      { header: 'Refund Due On', key: 'refundDueOn', width: 14, type: 'date' },
      { header: 'Refunded On', key: 'refundedOn', width: 13, type: 'date' },
      { header: 'Expiring in 30 Days', get: (r) => (r.expiringSoon ? 'Yes' : ''), width: 16 },
      { header: 'Validity Lapsed', get: (r) => (r.lapsed ? 'Yes' : ''), width: 14 },
      { header: 'Refund Overdue', get: (r) => (r.refundOverdue ? 'Yes' : ''), width: 14 },
      { header: 'Owner', key: 'owner', width: 18 },
      { header: 'Remarks', key: 'remarks', width: 36 },
      { header: 'Created By', key: 'createdByName', width: 18 },
      { header: 'Created On', key: 'createdAt', width: 18, type: 'datetime' },
      { header: 'Last Updated By', key: 'updatedBy', width: 18 },
      { header: 'Last Updated', key: 'updatedAt', width: 18, type: 'datetime' },
    ],
  });
});
