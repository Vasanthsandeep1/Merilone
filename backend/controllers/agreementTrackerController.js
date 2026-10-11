const { LetterDocument, AgreementTracking } = require('../models');
const { resolveActor } = require('../utils/orgActor');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');

// Tracker > Agreement Tracker — every agreement / letter in the Agreement section
// with the organisation's follow-up on it: sent to whom, response due, signed,
// valid until. Letters with no tracking row are "draft" (not sent yet).

const STATUSES = ['sent', 'under_review', 'signed', 'rejected', 'expired'];
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Emailing an agreement from the Agreement section is itself "sent" — so a letter
// with emails on record but no tracking row yet shows up as Sent (recipients as the
// counterparty, first email date as the sent date) until someone records more.
function fromShares(shares) {
  const list = Array.isArray(shares) ? shares : [];
  if (!list.length) return null;
  const first = list[0];
  const last = list[list.length - 1];
  const to = [...new Set(list.flatMap((x) => x.to || []))];
  return {
    counterparty: to.join(', '), sentOn: String(first.at).slice(0, 10), responseDueBy: null, signedOn: null, validUntil: null,
    owner: null, remarks: null, updatedBy: last.by || null, updatedAt: last.at,
    history: list.map((x) => ({ at: x.at, by: x.by, status: 'sent', note: `Emailed to ${(x.to || []).join(', ')}` })),
  };
}

const toRow = (d, t) => {
  const tr = t ? t.toJSON() : null;
  const auto = !tr ? fromShares(d.shares) : null;
  const status = tr ? tr.status : auto ? 'sent' : 'draft';
  const open = status === 'sent' || status === 'under_review';
  const tracking = tr ? {
    counterparty: tr.counterparty, sentOn: tr.sentOn, responseDueBy: tr.responseDueBy, signedOn: tr.signedOn, validUntil: tr.validUntil,
    owner: tr.owner, remarks: tr.remarks, updatedBy: tr.updatedBy, updatedAt: tr.updatedAt,
    history: Array.isArray(tr.history) ? tr.history : [],
  } : auto;
  return {
    id: d.id, title: d.title, source: d.source, folder: d.folder, division: d.division || null,
    bidNumber: d.bidNumber || null, urlId: d.bidNumber ? d.bidNumber.split('/').join('_') : null,
    createdByName: d.createdByName, createdAt: d.createdAt, updatedAt: d.updatedAt,
    sharedCount: Array.isArray(d.shares) ? d.shares.length : 0,
    status,
    auto: !!auto,
    overdue: !!(open && tracking && tracking.responseDueBy && tracking.responseDueBy < today()),
    expiringSoon: !!(status === 'signed' && tracking && tracking.validUntil && tracking.validUntil >= today() && tracking.validUntil <= inDays(30)),
    lapsed: !!(status === 'signed' && tracking && tracking.validUntil && tracking.validUntil < today()),
    tracking,
  };
};

// @route GET /api/agreement-tracker?status=&division=&search=&page=&limit=
exports.list = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

    const letters = await LetterDocument.findAll({ where: { userId }, attributes: { exclude: ['htmlContent'] }, order: [['updatedAt', 'DESC']] });
    const tracks = await AgreementTracking.findAll({ where: { userId } });
    const byLetter = new Map(tracks.map((t) => [t.letterId, t]));
    let rows = letters.map((d) => toRow(d, byLetter.get(d.id)));

    // Stats always cover the whole library, so the cards don't change with the filters.
    const stats = {
      total: rows.length,
      draft: rows.filter((r) => r.status === 'draft').length,
      sent: rows.filter((r) => r.status === 'sent').length,
      under_review: rows.filter((r) => r.status === 'under_review').length,
      signed: rows.filter((r) => r.status === 'signed').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      expired: rows.filter((r) => r.status === 'expired').length,
      overdue: rows.filter((r) => r.overdue).length,
      expiringSoon: rows.filter((r) => r.expiringSoon).length,
    };

    const { status, division, search } = req.query;
    if (status === 'overdue') rows = rows.filter((r) => r.overdue);
    else if (status === 'expiring') rows = rows.filter((r) => r.expiringSoon);
    else if (status === 'draft' || STATUSES.includes(status)) rows = rows.filter((r) => r.status === status);
    if (division === 'endo' || division === 'diagno') rows = rows.filter((r) => r.division === division);
    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter((r) => [r.title, r.bidNumber, r.folder, r.tracking && r.tracking.counterparty, r.tracking && r.tracking.owner, r.tracking && r.tracking.remarks]
        .some((v) => v && String(v).toLowerCase().includes(q)));
    }

    const total = rows.length;
    res.json({ success: true, data: rows.slice((page - 1) * limit, page * limit), total, page, limit, stats });
  } catch (err) {
    console.error('agreement tracker list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load agreement tracker' });
  }
};

// @route PUT /api/agreement-tracker/:letterId
// body: { status, counterparty, sentOn, responseDueBy, signedOn, validUntil, owner, remarks } or { clear: true } to go back to "draft".
exports.update = async (req, res) => {
  try {
    const letterId = parseInt(req.params.letterId, 10);
    const where = { userId: req.user.id, letterId };
    if (req.body.clear) { await AgreementTracking.destroy({ where }); return res.json({ success: true, cleared: true }); }

    const b = req.body;
    if (!STATUSES.includes(b.status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    if (b.status === 'sent' && !b.sentOn) return res.status(400).json({ success: false, message: 'Sent date is required' });
    if (b.status === 'signed' && !b.signedOn) return res.status(400).json({ success: false, message: 'Signed date is required' });

    const letter = await LetterDocument.findOne({ where: { id: letterId, userId: req.user.id }, attributes: ['id'] });
    if (!letter) return res.status(404).json({ success: false, message: 'Agreement not found' });

    const [row] = await AgreementTracking.findOrCreate({ where, defaults: { ...where, status: b.status } });
    const actor = await resolveActor(req).catch(() => null);
    const by = (actor && actor.actorName) || 'Unknown';
    const nz = (v) => (v === '' || v === undefined ? null : v);
    Object.assign(row, {
      status: b.status, counterparty: nz(b.counterparty), sentOn: nz(b.sentOn), responseDueBy: nz(b.responseDueBy),
      signedOn: nz(b.signedOn), validUntil: nz(b.validUntil), owner: nz(b.owner), remarks: nz(b.remarks), updatedBy: by,
      history: [...(row.history || []), { at: new Date().toISOString(), by, status: b.status, note: nz(b.remarks) }],
    });
    await row.save();
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('agreement tracker update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update tracking' });
  }
};

const AGR_STATUS = { draft: 'Draft', sent: 'Sent', under_review: 'Under review', signed: 'Signed', rejected: 'Rejected', expired: 'Expired' };

// @route GET /api/agreement-tracker/export?mode=all|filtered&status=&division=&search=
exports.exportExcel = safeHandler('agreement tracker', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.list, req, { clear: ['status', 'division', 'search'] });
  await sendWorkbook(res, {
    title: 'Agreement Tracker', rows, mode, applied,
    columns: [
      { header: 'Agreement', key: 'title', width: 46 },
      { header: 'Type', get: (r) => (r.source === 'ai' ? 'AI-drafted' : r.source === 'blank' ? 'Written manually' : 'Uploaded file'), width: 16 },
      { header: 'Tender', key: 'bidNumber', width: 24 },
      { header: 'Division', get: (r) => (r.division === 'endo' ? 'Meril Endo Surgery' : r.division === 'diagno' ? 'Meril Diagnostics' : ''), width: 20 },
      { header: 'Sent To', get: (r) => r.tracking && r.tracking.counterparty, width: 36 },
      { header: 'Status', get: (r) => AGR_STATUS[r.status] || r.status, width: 14 },
      { header: 'Overdue', get: (r) => (r.overdue ? 'Yes' : ''), width: 10 },
      { header: 'Expiring in 30 Days', get: (r) => (r.expiringSoon ? 'Yes' : ''), width: 16 },
      { header: 'Lapsed', get: (r) => (r.lapsed ? 'Yes' : ''), width: 9 },
      { header: 'Sent On', get: (r) => r.tracking && r.tracking.sentOn, width: 13, type: 'date' },
      { header: 'Response Due By', get: (r) => r.tracking && r.tracking.responseDueBy, width: 16, type: 'date' },
      { header: 'Signed On', get: (r) => r.tracking && r.tracking.signedOn, width: 13, type: 'date' },
      { header: 'Valid Until', get: (r) => r.tracking && r.tracking.validUntil, width: 13, type: 'date' },
      { header: 'Times Emailed', key: 'sharedCount', width: 13, type: 'number' },
      { header: 'Owner', get: (r) => r.tracking && r.tracking.owner, width: 18 },
      { header: 'Remarks', get: (r) => r.tracking && r.tracking.remarks, width: 36 },
      { header: 'Created By', key: 'createdByName', width: 18 },
      { header: 'Created On', key: 'createdAt', width: 18, type: 'datetime' },
      { header: 'Last Updated', get: (r) => (r.tracking && r.tracking.updatedAt) || r.updatedAt, width: 18, type: 'datetime' },
    ],
  });
});
