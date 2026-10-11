const { Liaison, LiaisonPayoutRequest, StaffUser, User } = require('../models');
const { notify } = require('../utils/notify');

// Liaison Management > Liaison Approvals — see models/LiaisonPayoutRequest.js
// for the full four-step chain. Every handler here is scoped to req.user's
// own organisation (staff tokens carry the org owner's id, same as every
// other per-partner register in this app) — this is NOT cross-tenant like
// Request Authorization; a liaison payout only ever moves within the one
// organisation that submitted it.

const MAX_PERCENTAGE = 10;

// Staff tokens carry a real DB role (sales/zonal_manager/flsp/tender_admin/
// finance/head); the org owner's own login is treated as able to act in
// EVERY one of these approval roles (same "Master Admin has full access"
// reasoning used for Request Authorization) — so an owner testing/covering
// for a role that hasn't been staffed yet is never blocked.
async function resolveApprover(req) {
  if (req.user.userType === 'staff') {
    const staff = await StaffUser.findByPk(req.user.staffId);
    if (!staff) return null;
    return { name: staff.name, role: staff.role, isOwner: false };
  }
  const user = await User.findByPk(req.user.id, { attributes: ['id', 'name'] });
  return { name: user?.name || 'Organization Admin', role: null, isOwner: true };
}

const canActAs = (approver, role) => approver.isOwner || approver.role === role;

function serialize(row) {
  const j = row.toJSON ? row.toJSON() : row;
  return {
    ...j,
    liaisonPercentage: Number(j.liaisonPercentage),
    grossProfitPercent: j.grossProfitPercent !== null ? Number(j.grossProfitPercent) : null,
    finalPercentage: j.finalPercentage !== null ? Number(j.finalPercentage) : null,
    slaOverdue: j.status === 'pending_zh_ta' && j.slaDeadline ? new Date(j.slaDeadline) < new Date() : false,
  };
}

const INCLUDE_LIAISON = { model: Liaison, as: 'liaison' };

// @route POST /api/liaison-payouts   multipart: documents[], + fields below
// body: { liaisonId, tenderNumber, liaisonPercentage, division, poNumber, grossProfitPercent }
exports.create = async (req, res) => {
  try {
    const { liaisonId, tenderNumber, division } = req.body;
    const liaisonPercentage = Number(req.body.liaisonPercentage);
    const poNumber = req.body.poNumber || null;
    const grossProfitPercent = req.body.grossProfitPercent ? Number(req.body.grossProfitPercent) : null;

    if (!liaisonId) return res.status(400).json({ success: false, message: 'Select a liaison' });
    if (!tenderNumber || !String(tenderNumber).trim()) return res.status(400).json({ success: false, message: 'Tender number is required' });
    if (!Number.isFinite(liaisonPercentage) || liaisonPercentage <= 0) return res.status(400).json({ success: false, message: 'A valid liaison percentage is required' });
    if (liaisonPercentage > MAX_PERCENTAGE) return res.status(400).json({ success: false, message: `Liaison percentage cannot exceed ${MAX_PERCENTAGE}%` });
    if (!['MEPL', 'MDPL'].includes(division)) return res.status(400).json({ success: false, message: 'Select a valid division (MEPL/MDPL)' });

    const liaison = await Liaison.findOne({ where: { id: liaisonId, userId: req.user.id } });
    if (!liaison) return res.status(404).json({ success: false, message: 'Liaison not found' });

    const approver = await resolveApprover(req);
    const files = req.files || [];
    const documents = files.map((f) => ({ fileName: f.originalname, fileUrl: `/uploads/${f.filename}`, fileSize: f.size, uploadedAt: new Date() }));

    const slaDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const row = await LiaisonPayoutRequest.create({
      userId: req.user.id, liaisonId, tenderNumber: String(tenderNumber).trim(), liaisonPercentage, division,
      poNumber, grossProfitPercent, documents, status: 'pending_zh_ta', slaDeadline, createdByName: approver?.name || null,
    });

    await notify(req.user.id, {
      type: 'liaison_payout_submitted',
      title: 'Liaison Approval Needed',
      message: `${approver?.name || 'Someone'} submitted a liaison payout for ${liaison.name} (Tender ${tenderNumber}) — needs Zonal Head + Tender Admin acknowledgement within 24h.`,
      relatedType: 'LiaisonPayoutRequest', relatedId: row.id,
    });

    const full = await LiaisonPayoutRequest.findByPk(row.id, { include: [INCLUDE_LIAISON] });
    res.status(201).json({ success: true, data: serialize(full) });
  } catch (err) {
    console.error('liaisonPayout create error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit liaison for approval' });
  }
};

// @route GET /api/liaison-payouts?status=
exports.list = async (req, res) => {
  try {
    const where = { userId: req.user.id };
    if (req.query.status) where.status = req.query.status;
    const rows = await LiaisonPayoutRequest.findAll({ where, include: [INCLUDE_LIAISON], order: [['createdAt', 'DESC']] });
    const approver = await resolveApprover(req);
    res.json({
      success: true,
      data: rows.map(serialize),
      myRole: approver?.isOwner ? 'owner' : approver?.role || null,
    });
  } catch (err) {
    console.error('liaisonPayout list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load liaison approvals' });
  }
};

// @route GET /api/liaison-payouts/:id
exports.detail = async (req, res) => {
  try {
    const row = await LiaisonPayoutRequest.findOne({ where: { id: req.params.id, userId: req.user.id }, include: [INCLUDE_LIAISON] });
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('liaisonPayout detail error:', err);
    res.status(500).json({ success: false, message: 'Failed to load request' });
  }
};

async function findOwnPending(req, status) {
  return LiaisonPayoutRequest.findOne({ where: { id: req.params.id, userId: req.user.id, status }, include: [INCLUDE_LIAISON] });
}

// @route POST /api/liaison-payouts/:id/zh-approve
exports.zhApprove = async (req, res) => {
  try {
    const approver = await resolveApprover(req);
    if (!canActAs(approver, 'zonal_manager')) return res.status(403).json({ success: false, message: 'Only the Zonal Head can acknowledge this' });
    const row = await findOwnPending(req, 'pending_zh_ta');
    if (!row) return res.status(404).json({ success: false, message: 'No pending request found' });
    if (row.zhApprovedAt) return res.status(400).json({ success: false, message: 'Already acknowledged by Zonal Head' });

    row.zhApprovedAt = new Date();
    row.zhApprovedByName = approver.name;
    await advanceIfBothAcked(row);
    await row.save();
    res.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('liaisonPayout zhApprove error:', err);
    res.status(500).json({ success: false, message: 'Failed to acknowledge' });
  }
};

// @route POST /api/liaison-payouts/:id/ta-approve
exports.taApprove = async (req, res) => {
  try {
    const approver = await resolveApprover(req);
    if (!canActAs(approver, 'tender_admin')) return res.status(403).json({ success: false, message: 'Only the Tender Admin can acknowledge this' });
    const row = await findOwnPending(req, 'pending_zh_ta');
    if (!row) return res.status(404).json({ success: false, message: 'No pending request found' });
    if (row.taApprovedAt) return res.status(400).json({ success: false, message: 'Already acknowledged by Tender Admin' });

    row.taApprovedAt = new Date();
    row.taApprovedByName = approver.name;
    await advanceIfBothAcked(row);
    await row.save();
    res.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('liaisonPayout taApprove error:', err);
    res.status(500).json({ success: false, message: 'Failed to acknowledge' });
  }
};

async function advanceIfBothAcked(row) {
  if (row.zhApprovedAt && row.taApprovedAt) {
    row.status = 'pending_finance';
    await notify(row.userId, {
      type: 'liaison_payout_pending_finance',
      title: 'Liaison Approval — Finance Review',
      message: `Zonal Head and Tender Admin have acknowledged the liaison payout for Tender ${row.tenderNumber} — now awaiting Finance (percentage + payment terms).`,
      relatedType: 'LiaisonPayoutRequest', relatedId: row.id,
    });
  }
}

// @route POST /api/liaison-payouts/:id/finance-approve   { paymentTermsDays }
exports.financeApprove = async (req, res) => {
  try {
    const approver = await resolveApprover(req);
    if (!canActAs(approver, 'finance')) return res.status(403).json({ success: false, message: 'Only Finance can approve this stage' });
    const paymentTermsDays = Number(req.body.paymentTermsDays);
    if (!Number.isFinite(paymentTermsDays) || paymentTermsDays < 0) return res.status(400).json({ success: false, message: 'A valid payment terms duration (in days) is required' });

    const row = await findOwnPending(req, 'pending_finance');
    if (!row) return res.status(404).json({ success: false, message: 'No request pending Finance approval' });

    row.financeApprovedAt = new Date();
    row.financeApprovedByName = approver.name;
    row.paymentTermsDays = paymentTermsDays;
    row.status = 'pending_head';
    await row.save();

    await notify(row.userId, {
      type: 'liaison_payout_pending_head',
      title: 'Liaison Approval — Head Review',
      message: `Finance approved the liaison payout for Tender ${row.tenderNumber} (payment terms: ${paymentTermsDays} days) — now awaiting final Head approval.`,
      relatedType: 'LiaisonPayoutRequest', relatedId: row.id,
    });

    res.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('liaisonPayout financeApprove error:', err);
    res.status(500).json({ success: false, message: 'Failed to approve' });
  }
};

// @route POST /api/liaison-payouts/:id/head-approve   { finalPercentage? }
// Head can see everything (bio-data + documents, via GET detail) and may
// revise the percentage in the organisation's favour before final approval
// — finalPercentage defaults to the originally requested liaisonPercentage
// when Head doesn't change it.
exports.headApprove = async (req, res) => {
  try {
    const approver = await resolveApprover(req);
    if (!canActAs(approver, 'head')) return res.status(403).json({ success: false, message: 'Only Head can give final approval' });

    const row = await findOwnPending(req, 'pending_head');
    if (!row) return res.status(404).json({ success: false, message: 'No request pending Head approval' });

    let finalPercentage = row.liaisonPercentage;
    if (req.body.finalPercentage !== undefined && req.body.finalPercentage !== null && req.body.finalPercentage !== '') {
      const v = Number(req.body.finalPercentage);
      if (!Number.isFinite(v) || v <= 0 || v > MAX_PERCENTAGE) return res.status(400).json({ success: false, message: `Final percentage must be between 0 and ${MAX_PERCENTAGE}%` });
      finalPercentage = v;
    }

    row.headApprovedAt = new Date();
    row.headApprovedByName = approver.name;
    row.finalPercentage = finalPercentage;
    row.status = 'approved';
    await row.save();

    await notify(row.userId, {
      type: 'liaison_payout_approved',
      title: 'Liaison Payout Approved',
      message: `${approver.name} gave final approval on the liaison payout for Tender ${row.tenderNumber} at ${finalPercentage}%.`,
      relatedType: 'LiaisonPayoutRequest', relatedId: row.id,
    });

    res.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('liaisonPayout headApprove error:', err);
    res.status(500).json({ success: false, message: 'Failed to approve' });
  }
};

const STAGE_ROLE = { pending_zh_ta: null, pending_finance: 'finance', pending_head: 'head' };

// @route POST /api/liaison-payouts/:id/reject   { remarks }
// Any of the four roles can reject at whichever stage the request is
// currently sitting in — pending_zh_ta allows either Zonal Head or Tender
// Admin to reject (no need for both to agree on a rejection).
exports.reject = async (req, res) => {
  try {
    const remarks = (req.body.remarks || '').trim();
    if (!remarks) return res.status(400).json({ success: false, message: 'A reason is required to reject' });

    const row = await LiaisonPayoutRequest.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });
    if (!['pending_zh_ta', 'pending_finance', 'pending_head'].includes(row.status)) {
      return res.status(400).json({ success: false, message: 'This request has already been decided' });
    }

    const approver = await resolveApprover(req);
    const stage = row.status;
    const allowed = stage === 'pending_zh_ta' ? (canActAs(approver, 'zonal_manager') || canActAs(approver, 'tender_admin')) : canActAs(approver, STAGE_ROLE[stage]);
    if (!allowed) return res.status(403).json({ success: false, message: 'You are not the approver for this stage' });

    row.status = 'rejected';
    row.rejectedAt = new Date();
    row.rejectedStage = stage;
    row.rejectedByName = approver.name;
    row.rejectionRemarks = remarks;
    await row.save();

    await notify(row.userId, {
      type: 'liaison_payout_rejected',
      title: 'Liaison Payout Rejected',
      message: `${approver.name} rejected the liaison payout for Tender ${row.tenderNumber}: ${remarks}`,
      relatedType: 'LiaisonPayoutRequest', relatedId: row.id,
    });

    res.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('liaisonPayout reject error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject' });
  }
};
