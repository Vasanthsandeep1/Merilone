const { ProcessDecodeRequest, PartnerDistributor, TenderProcessingResult } = require('../models');
const { fromUrlId } = require('./tenderController').helpers;
const { resolveActor, isSameActor } = require('../utils/orgActor');

// Ported from OLD's "Process Decode" (Deviation Analysis page) — a
// rate/pricing-working Excel-like sheet that goes through an approval
// chain before a partner quotes a tender. Single-stage here (any Zonal
// Manager in the org decides) instead of OLD's Zonal Head->Finance chain,
// since this app has no Finance role — a deliberate simplification, not an
// oversight (see plan). No email/notification wiring in this pass; the
// page itself is the source of truth for status.

// One row per suggested item, seeded the same way OLD's seedRows did —
// tender requirement/spec text, current match, and a joined deviation
// summary — so a fresh sheet already reflects the tender's own data
// instead of starting completely blank.
function seedRows(suggestedProducts, deviationTables) {
  return (suggestedProducts || []).map((p, i) => {
    const rows = (deviationTables || {})[p.item] || [];
    const notComplied = rows.filter((r) => r.status && r.status !== 'Complied');
    return {
      sl: i + 1,
      tenderSl: '',
      item: p.tender_item_name || p.item_category || '',
      addlSpec: rows.map((r) => r.specification).filter(Boolean).join(', '),
      qty: '',
      code: p.product_code || '',
      relevancy: typeof p.relevancy_score === 'number' ? `${Math.round(p.relevancy_score * 100)}%` : '',
      deviation: notComplied.length ? notComplied.map((r) => r.reason).filter(Boolean).join(' | ') : 'Complied',
      brand: '',
      packing: '',
      gst: '',
      hsn: '',
      mrp: '',
      netRate: '',
      margin: '',
      quoteRate: '',
      ourSpec: rows.map((r) => r.product_offered).filter(Boolean).join(', '),
    };
  });
}

// @route GET /api/tenders/:bidNumber/process-decode
exports.getProcessDecode = async (req, res) => {
  try {
    const actor = await resolveActor(req);
    if (!actor) return res.status(404).json({ success: false, message: 'Complete your organization profile first' });
    const bidNumber = fromUrlId(req.params.bidNumber);

    const request = await ProcessDecodeRequest.findOne({
      where: { bidNo: bidNumber, partnerProfileId: actor.partnerProfileId },
      order: [['createdAt', 'DESC']],
    });

    let seed = [];
    if (!request) {
      const result = await TenderProcessingResult.findOne({ where: { bidNo: bidNumber } });
      seed = seedRows(result?.suggestedProducts, result?.deviationTables);
    }

    res.json({
      success: true,
      data: {
        request,
        seedRows: seed,
        canDecide: actor.isZonalManager,
        isRequester: request ? isSameActor(actor, request, 'requestedByStaffId', 'requestedByUserId') : false,
      },
    });
  } catch (err) {
    console.error('getProcessDecode error:', err);
    res.status(500).json({ success: false, message: 'Failed to load process decode' });
  }
};

// @route POST /api/tenders/:bidNumber/process-decode
exports.submitProcessDecode = async (req, res) => {
  try {
    const actor = await resolveActor(req);
    if (!actor) return res.status(404).json({ success: false, message: 'Complete your organization profile first' });
    const bidNumber = fromUrlId(req.params.bidNumber);
    const { ratesFor, ref, rows, participation, distributorId } = req.body || {};

    const existing = await ProcessDecodeRequest.findOne({ where: { bidNo: bidNumber, partnerProfileId: actor.partnerProfileId, status: 'pending' } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'A process decode sheet is already pending for this tender.' });
    }

    if (participation === 'distributor' && !distributorId) {
      return res.status(400).json({ success: false, message: 'Select a distributor' });
    }
    let distributorName = null;
    if (participation === 'distributor') {
      // PartnerDistributor is scoped by userId (the org owner's id), not
      // partnerProfileId — req.user.id is that owner id for both partner
      // and staff tokens (see generateStaffToken), same as
      // dealersController.listDistributors already relies on.
      const distributor = await PartnerDistributor.findOne({ where: { id: distributorId, userId: req.user.id } });
      distributorName = distributor?.companyName || null;
    }

    const request = await ProcessDecodeRequest.create({
      bidNo: bidNumber,
      partnerProfileId: actor.partnerProfileId,
      requestedByStaffId: actor.staffId,
      requestedByUserId: actor.userId,
      requesterName: actor.actorName,
      reference: ratesFor || null,
      remarks: `Process Decode sheet — ${(rows || []).length} item(s)`,
      payload: { ratesFor, ref, rows, participation, distributorId: participation === 'distributor' ? distributorId : null, distributorName },
      status: 'pending',
      stageHistory: [{ decision: 'submitted', by: actor.actorName, at: new Date().toISOString() }],
    });

    res.status(201).json({ success: true, data: request });
  } catch (err) {
    console.error('submitProcessDecode error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit process decode' });
  }
};

// @route PATCH /api/tenders/:bidNumber/process-decode/:id/payload
exports.updateProcessDecodePayload = async (req, res) => {
  try {
    const actor = await resolveActor(req);
    if (!actor) return res.status(404).json({ success: false, message: 'Complete your organization profile first' });
    const request = await ProcessDecodeRequest.findOne({ where: { id: req.params.id, partnerProfileId: actor.partnerProfileId } });
    if (!request) return res.status(404).json({ success: false, message: 'Process decode sheet not found' });
    if (request.status !== 'pending') return res.status(409).json({ success: false, message: 'This sheet has already been decided' });

    const isRequester = isSameActor(actor, request, 'requestedByStaffId', 'requestedByUserId');
    if (!isRequester && !actor.isZonalManager) {
      return res.status(403).json({ success: false, message: 'Only the requester or a Zonal Manager can edit this sheet' });
    }

    const { ratesFor, ref, rows, participation, distributorId, distributorName } = req.body || {};
    request.payload = { ratesFor, ref, rows, participation, distributorId, distributorName };
    await request.save();
    res.json({ success: true, data: request });
  } catch (err) {
    console.error('updateProcessDecodePayload error:', err);
    res.status(500).json({ success: false, message: 'Failed to save changes' });
  }
};

// @route POST /api/tenders/:bidNumber/process-decode/:id/decide
exports.decideProcessDecode = async (req, res) => {
  try {
    const actor = await resolveActor(req);
    if (!actor) return res.status(404).json({ success: false, message: 'Complete your organization profile first' });
    if (!actor.isZonalManager) {
      return res.status(403).json({ success: false, message: 'Only a Zonal Manager can approve or reject a process decode sheet' });
    }

    const request = await ProcessDecodeRequest.findOne({ where: { id: req.params.id, partnerProfileId: actor.partnerProfileId } });
    if (!request) return res.status(404).json({ success: false, message: 'Process decode sheet not found' });
    if (request.status !== 'pending') return res.status(409).json({ success: false, message: 'This sheet has already been decided' });
    if (isSameActor(actor, request, 'requestedByStaffId', 'requestedByUserId')) {
      return res.status(403).json({ success: false, message: 'You cannot approve your own submission' });
    }

    const { decision, note } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'decision must be approved or rejected' });
    }
    if (decision === 'rejected' && !note?.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required to reject' });
    }

    request.status = decision;
    request.decisionNote = note || null;
    request.decidedByStaffId = actor.staffId;
    request.decidedByUserId = actor.userId;
    request.deciderName = actor.actorName;
    request.decidedAt = new Date();
    request.stageHistory = [...(request.stageHistory || []), { decision, note: note || null, by: actor.actorName, at: new Date().toISOString() }];
    await request.save();

    res.json({ success: true, data: request });
  } catch (err) {
    console.error('decideProcessDecode error:', err);
    res.status(500).json({ success: false, message: 'Failed to record decision' });
  }
};
