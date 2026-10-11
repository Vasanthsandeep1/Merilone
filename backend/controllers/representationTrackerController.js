const { QueryTypes } = require('sequelize');
const { sequelize, RepresentationTracking } = require('../models');
const { fromUrlId, toUrlId } = require('./tenderController').helpers;
const { resolveActor } = require('../utils/orgActor');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');

// Tenders > Representation Tracker — follows every tender that has
// Not-Complied/Deviation rows (i.e. needs a representation letter) from
// "nothing written yet" through drafted, submitted, and the buyer's
// response. See models/RepresentationTracking.js for which parts are
// derived vs. stored.

const isDeviation = (r) => r && (r.status === 'Not Complied' || r.status === 'Deviation');

function derive(row, tracking) {
  const tables = typeof row.deviation_tables === 'string' ? JSON.parse(row.deviation_tables) : (row.deviation_tables || {});
  let totalRows = 0;
  let deviationRows = 0;
  const itemsWithDeviation = [];
  for (const [item, rows] of Object.entries(tables)) {
    const list = Array.isArray(rows) ? rows : [];
    totalRows += list.length;
    const d = list.filter(isDeviation).length;
    deviationRows += d;
    if (d) itemsWithDeviation.push(item);
  }
  const letterGenerated = !!row.representation_generated_at;
  let status = 'pending';
  if (tracking) status = tracking.stage;
  else if (letterGenerated) status = 'drafted';

  const hoursLeft = row.end_date_dt ? Math.round((new Date(row.end_date_dt).getTime() - Date.now()) / 3.6e6) : null;
  return {
    bidNumber: row.bid_no,
    urlId: toUrlId(row.bid_no),
    title: row.title || row.item_category || row.bid_no,
    dept: row.gt_dept || row.dept || null,
    state: row.state || null,
    endDate: row.end_date_dt || null,
    hoursLeft,
    totalRows,
    deviationRows,
    itemsWithDeviation,
    letterGenerated,
    letterUpdatedAt: row.representation_generated_at || null,
    letterGeneratedBy: row.representation_generated_by || null,
    letterRows: Number(row.letter_rows) || 0,
    status,
    submittedAt: tracking?.submittedAt || null,
    respondedAt: tracking?.respondedAt || null,
    submittedTo: tracking?.submittedTo || null,
    remarks: tracking?.remarks || null,
    sentBy: tracking?.sentBy || null,
    sentVia: tracking?.sentVia || null,
    receivedBy: tracking?.receivedBy || null,
    acknowledgementRef: tracking?.acknowledgementRef || null,
    updatedBy: tracking?.updatedBy || null,
    updatedAt: tracking?.updatedAt || null,
    history: tracking?.history || [],
  };
}

// @route GET /api/representation-tracker?search=&status=&dept=&page=&limit=
exports.list = async (req, res) => {
  try {
    const { search = '', status = '', dept = '' } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const rows = await sequelize.query(
      `SELECT tpr.bid_no, tpr.dept, tpr.item_category, tpr.deviation_tables, tpr.representation_generated_at, tpr.representation_generated_by,
              JSON_LENGTH(tpr.representation_data) AS letter_rows,
              gt.items AS title, gt.dept AS gt_dept, gt.state, gt.end_date_dt
       FROM tender_processing_results tpr
       LEFT JOIN gem_tenders gt ON gt.bid_number = tpr.bid_no
       WHERE tpr.deviation_tables LIKE '%Not Complied%' OR tpr.deviation_tables LIKE '%"Deviation"%'
          OR tpr.representation_generated_at IS NOT NULL`,
      { type: QueryTypes.SELECT },
    );
    const trackings = await RepresentationTracking.findAll({ where: { userId: req.user.id } });
    const trackByBid = new Map(trackings.map((t) => [t.bidNumber, t]));

    let items = rows.map((r) => derive(r, trackByBid.get(r.bid_no))).filter((i) => i.deviationRows > 0 || i.letterGenerated);

    const stats = { total: items.length, pending: 0, drafted: 0, submitted: 0, accepted: 0, partially_accepted: 0, rejected: 0 };
    for (const i of items) stats[i.status] += 1;

    const s = search.trim().toLowerCase();
    if (s) items = items.filter((i) => i.bidNumber.toLowerCase().includes(s) || (i.title || '').toLowerCase().includes(s));
    if (status) items = items.filter((i) => i.status === status);
    if (dept) items = items.filter((i) => (i.dept || '').toLowerCase().includes(dept.toLowerCase()));

    // Needs-attention first: pending/drafted, then by nearest closing date.
    const rank = { pending: 0, drafted: 1, submitted: 2, partially_accepted: 3, rejected: 3, accepted: 4 };
    // Still-open tenders (nearest deadline first) ahead of already-closed ones.
    const urgency = (h) => (h == null ? 2e9 : h < 0 ? 1e9 - h : h);
    items.sort((a, b) => (rank[a.status] - rank[b.status]) || (urgency(a.hoursLeft) - urgency(b.hoursLeft)));

    const total = items.length;
    res.json({ success: true, data: items.slice((page - 1) * limit, page * limit), total, stats });
  } catch (err) {
    console.error('representation tracker list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load representation tracker' });
  }
};

// @route PUT /api/representation-tracker/:bidNumber
// body: { stage, submittedAt, respondedAt, submittedTo, remarks } — or
// { clear: true } to drop back to the derived Pending/Drafted state.
exports.update = async (req, res) => {
  try {
    const bidNumber = fromUrlId(req.params.bidNumber);
    const where = { userId: req.user.id, bidNumber };

    if (req.body.clear) {
      await RepresentationTracking.destroy({ where });
      return res.json({ success: true, cleared: true });
    }

    const { stage, submittedAt, respondedAt, submittedTo, remarks, sentBy, sentVia, receivedBy, acknowledgementRef } = req.body;
    if (!['submitted', 'accepted', 'partially_accepted', 'rejected'].includes(stage)) {
      return res.status(400).json({ success: false, message: 'Invalid stage' });
    }
    if (stage !== 'submitted' && !submittedAt) {
      return res.status(400).json({ success: false, message: 'Submitted date is required before recording a response' });
    }
    if (submittedAt && respondedAt && new Date(respondedAt) < new Date(submittedAt)) {
      return res.status(400).json({ success: false, message: 'Response date cannot be before the submitted date' });
    }

    const [row] = await RepresentationTracking.findOrCreate({ where, defaults: { ...where, stage } });
    const today = new Date().toISOString().slice(0, 10);
    row.stage = stage;
    row.submittedAt = submittedAt || row.submittedAt || today;
    row.respondedAt = stage === 'submitted' ? null : (respondedAt || today);
    if (submittedTo !== undefined) row.submittedTo = submittedTo || null;
    if (remarks !== undefined) row.remarks = remarks || null;
    if (sentVia !== undefined) row.sentVia = sentVia || null;
    if (receivedBy !== undefined) row.receivedBy = receivedBy || null;
    if (acknowledgementRef !== undefined) row.acknowledgementRef = acknowledgementRef || null;
    const actor = await resolveActor(req).catch(() => null);
    const actorName = actor?.actorName || 'Unknown';
    // "Sent by" defaults to whoever first marks it submitted, but can be
    // overridden when someone else physically sent it.
    row.sentBy = sentBy || row.sentBy || actorName;
    row.updatedBy = actorName;
    row.history = [...(row.history || []), { at: new Date().toISOString(), by: actorName, stage, note: remarks || null }];
    await row.save();
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('representation tracker update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update tracking' });
  }
};

const REP_STATUS = { pending: 'Pending', drafted: 'Drafted', submitted: 'Submitted', accepted: 'Accepted', partially_accepted: 'Partially accepted', rejected: 'Rejected' };

// @route GET /api/representation-tracker/export?mode=all|filtered&search=&status=&dept=
exports.exportExcel = safeHandler('representation tracker', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.list, req, { clear: ['search', 'status', 'dept'] });
  await sendWorkbook(res, {
    title: 'Representation Tracker', rows, mode, applied,
    columns: [
      { header: 'Bid Number', key: 'bidNumber', width: 24 },
      { header: 'Title', key: 'title', width: 44 },
      { header: 'Department', key: 'dept', width: 12 },
      { header: 'State', key: 'state', width: 16 },
      { header: 'Closing Date', key: 'endDate', width: 18, type: 'datetime' },
      { header: 'Deviation Rows', key: 'deviationRows', width: 14, type: 'number' },
      { header: 'Total Spec Rows', key: 'totalRows', width: 14, type: 'number' },
      { header: 'Items With Deviation', key: 'itemsWithDeviation', width: 40 },
      { header: 'Letter Generated', get: (r) => (r.letterGenerated ? 'Yes' : 'No'), width: 14 },
      { header: 'Letter Updated', key: 'letterUpdatedAt', width: 18, type: 'datetime' },
      { header: 'Letter Generated By', key: 'letterGeneratedBy', width: 20 },
      { header: 'Status', get: (r) => REP_STATUS[r.status] || r.status, width: 18 },
      { header: 'Submitted On', key: 'submittedAt', width: 14, type: 'date' },
      { header: 'Submitted To', key: 'submittedTo', width: 26 },
      { header: 'Sent By', key: 'sentBy', width: 18 },
      { header: 'Sent Via', key: 'sentVia', width: 14 },
      { header: 'Received By', key: 'receivedBy', width: 18 },
      { header: 'Acknowledgement Ref', key: 'acknowledgementRef', width: 22 },
      { header: 'Response On', key: 'respondedAt', width: 14, type: 'date' },
      { header: 'Remarks', key: 'remarks', width: 36 },
      { header: 'Last Updated By', key: 'updatedBy', width: 18 },
      { header: 'Last Updated', key: 'updatedAt', width: 18, type: 'datetime' },
    ],
  });
});
