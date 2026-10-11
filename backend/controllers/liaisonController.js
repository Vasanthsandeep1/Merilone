'use strict';
// Liaison Management — Liaison Recommendation (find the right person for a
// tender/organization/hospital/region) and Liaison Ranking (compare
// performance across the whole directory). Both pages score liaisons purely
// from real logged activity (models/LiaisonInteraction.js) — never a
// hand-typed rank — so the score changes as the organisation actually uses
// the module. Scoped by userId throughout, same as every other org-owned
// register in this app.
const { Op } = require('sequelize');
const { Liaison, LiaisonInteraction, LiaisonPayoutRequest } = require('../models');
const { resolveActor } = require('../utils/orgActor');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');

const ZONES = ['North', 'South', 'East', 'West', 'Central'];
const ORG_TYPES = [
  { key: 'government_hospital', label: 'Government Hospitals' },
  { key: 'state_health_dept', label: 'State Health Department' },
  { key: 'municipal_corporation', label: 'Municipal Corporation' },
  { key: 'psu', label: 'Public Sector Undertakings' },
  { key: 'educational_institution', label: 'Educational Institutions' },
  { key: 'central_govt', label: 'Central Government Organizations' },
  { key: 'other', label: 'Other' },
];
const STAGES_AFTER_CONTACT = ['response', 'meeting', 'follow_up', 'outcome'];

const nz = (v) => (v === '' || v === undefined ? null : v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const actorName = async (req) => { try { return (await resolveActor(req))?.actorName || null; } catch (_) { return null; } };
const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : Infinity);
const lc = (v) => String(v || '').trim().toLowerCase();

// ---- derive real activity stats for one liaison from its logged interactions ----
function statsFor(interactions) {
  const tenderKeys = new Set(interactions.map((i) => i.tenderBidNumber || `#${i.id}`));
  const outcomes = interactions.filter((i) => i.stage === 'outcome');
  const successful = outcomes.filter((i) => i.outcome === 'successful');
  const contacted = interactions.filter((i) => i.stage === 'contacted').length;
  const responded = interactions.filter((i) => STAGES_AFTER_CONTACT.includes(i.stage)).length;
  const lastAt = interactions.reduce((max, i) => (!max || i.occurredOn > max ? i.occurredOn : max), null);
  const distinctOrgs = new Set(interactions.map((i) => lc(i.organization)).filter(Boolean));
  const distinctStates = new Set(interactions.map((i) => lc(i.state)).filter(Boolean));
  const distinctDistricts = new Set(interactions.map((i) => lc(i.district)).filter(Boolean));
  const categories = new Set(interactions.flatMap((i) => [lc(i.tenderCategory), lc(i.productCategory)]).filter(Boolean));

  const relevantTenders = tenderKeys.size;
  const successfulConnections = successful.length;
  const successRate = outcomes.length ? successfulConnections / outcomes.length : 0;
  const responseRate = contacted ? clamp(responded / contacted, 0, 1) : (interactions.length ? 1 : 0);
  const dLast = daysSince(lastAt);
  const strength = interactions.length === 0 ? 'New'
    : interactions.length >= 10 && dLast <= 30 ? 'Strong'
      : interactions.length >= 3 && dLast <= 90 ? 'Medium' : 'Weak';

  return { relevantTenders, successfulConnections, successRate, responseRate, lastInteractionAt: lastAt, daysSinceLast: dLast, strength, distinctOrgs, distinctStates, distinctDistricts, categories, interactionCount: interactions.length };
}
const strengthFactor = (s) => ({ Strong: 1, Medium: 0.6, Weak: 0.25, New: 0 }[s] ?? 0);

// ---- Recommendation score: how well this liaison fits ONE specific ask ----
function scoreForRecommendation(liaison, stats, q) {
  let geo = 0.5; // neutral when nothing geographic was asked
  if (q.state || q.zone || q.district) {
    geo = 0;
    if (q.state) geo += lc(liaison.state) === lc(q.state) ? 0.6 : (stats.distinctStates.has(lc(q.state)) ? 0.3 : 0);
    if (q.district) geo += lc(liaison.district) === lc(q.district) ? 0.25 : (stats.distinctDistricts.has(lc(q.district)) ? 0.15 : 0);
    if (q.zone) geo += lc(liaison.zone) === lc(q.zone) ? 0.15 : 0;
    geo = clamp(geo, 0, 1);
  }

  let org = 0.4;
  if (q.orgType || q.organization) {
    org = 0;
    if (q.orgType) org += liaison.orgType === q.orgType ? 0.7 : 0;
    if (q.organization) org += lc(liaison.organization).includes(lc(q.organization)) || stats.distinctOrgs.has(lc(q.organization)) ? 0.6 : 0;
    org = clamp(org, 0, 1);
  }

  let dept = 0.4;
  if (q.department) dept = lc(liaison.department).includes(lc(q.department)) ? 1 : 0;

  let hospital = 0.4;
  if (q.hospital) hospital = lc(liaison.hospital).includes(lc(q.hospital)) ? 1 : 0;

  let category = 0.35;
  if (q.tenderCategory || q.productCategory) {
    const want = [lc(q.tenderCategory), lc(q.productCategory)].filter(Boolean);
    category = want.some((w) => [...stats.categories].some((c) => c.includes(w) || w.includes(c))) ? 1 : 0.15;
  }

  const experience = clamp(liaison.experienceYears / 15, 0, 1);
  const relationship = strengthFactor(stats.strength);

  const breakdown = {
    geoMatch: Math.round(geo * 25), orgMatch: Math.round(org * 20), deptMatch: Math.round(dept * 15),
    categoryMatch: Math.round(category * 15), historicalSuccess: Math.round(stats.successRate * 10),
    experience: Math.round(experience * 10), relationship: Math.round(relationship * 5),
  };
  // hospital folds into org/dept weight rather than its own slot (keeps the published 7-factor 100% split intact)
  const hospitalNudge = q.hospital ? (hospital - 0.4) * 10 : 0;
  const score = clamp(Math.round(Object.values(breakdown).reduce((s, v) => s + v, 0) + hospitalNudge), 0, 100);
  return { score, breakdown };
}

// ---- Ranking score: general standing, independent of any one request ----
function scoreForRanking(liaison, stats) {
  const tenderRelevance = clamp(stats.relevantTenders / 30, 0, 1);
  const connections = clamp(stats.successfulConnections / 20, 0, 1);
  const orgRelevance = clamp(stats.distinctOrgs.size / 5, 0, 1);
  const geoRelevance = clamp((liaison.state ? 0.4 : 0) + stats.distinctDistricts.size / 5 * 0.6, 0, 1);
  const experience = clamp(liaison.experienceYears / 15, 0, 1);
  const relationship = strengthFactor(stats.strength);

  const breakdown = {
    tenderRelevance: Math.round(tenderRelevance * 25), connections: Math.round(connections * 20),
    orgRelevance: Math.round(orgRelevance * 15), geoRelevance: Math.round(geoRelevance * 15),
    responseRate: Math.round(stats.responseRate * 10), relationship: Math.round(relationship * 10),
    experience: Math.round(experience * 5),
  };
  const score = clamp(Object.values(breakdown).reduce((s, v) => s + v, 0), 0, 100);
  return { score, breakdown };
}

const tierOf = (score) => (score >= 85 ? 'Excellent Match' : score >= 70 ? 'Strong' : score >= 50 ? 'Moderate' : 'Limited');

function explain(liaison, stats, q) {
  const bits = [];
  if (q.state && lc(liaison.state) === lc(q.state)) bits.push(`is based in ${liaison.state}`);
  if (stats.relevantTenders > 0) bits.push(`has handled ${stats.relevantTenders} similar tender${stats.relevantTenders === 1 ? '' : 's'}`);
  if (q.organization && (lc(liaison.organization).includes(lc(q.organization)) || stats.distinctOrgs.has(lc(q.organization)))) bits.push(`has worked with ${q.organization} before`);
  if (stats.successfulConnections > 0) bits.push(`${stats.successfulConnections} successful connection${stats.successfulConnections === 1 ? '' : 's'} on record`);
  if (!bits.length) return liaison.experienceYears ? `${liaison.experienceYears} years of experience in ${liaison.department || liaison.organization || 'this area'}, though no logged interactions yet.` : 'No logged activity yet — recommended on profile match alone.';
  return `Recommended because this liaison ${bits.join(', ')}.`;
}

// dateRange narrows which interactions count toward the stats/score (Liaison
// Ranking's Time Period filter) — the liaisons themselves are unaffected,
// only their activity numbers for that window.
async function loadWithStats(req, where, dateRange) {
  const liaisons = await Liaison.findAll({ where: { userId: req.user.id, ...where }, order: [['name', 'ASC']] });
  const interWhere = { userId: req.user.id };
  if (dateRange?.from) interWhere.occurredOn = { ...(interWhere.occurredOn || {}), [Op.gte]: dateRange.from };
  if (dateRange?.to) interWhere.occurredOn = { ...(interWhere.occurredOn || {}), [Op.lte]: dateRange.to };
  const interactions = await LiaisonInteraction.findAll({ where: interWhere, raw: true });
  const byLiaison = new Map();
  interactions.forEach((i) => { if (!byLiaison.has(i.liaisonId)) byLiaison.set(i.liaisonId, []); byLiaison.get(i.liaisonId).push(i); });
  return liaisons.map((l) => ({ liaison: l.toJSON(), stats: statsFor(byLiaison.get(l.id) || []) }));
}

function periodToRange(period, from, to) {
  if (period === 'custom') return { from: from || null, to: to || null };
  const now = new Date();
  const start = new Date(now);
  if (period === 'week') start.setDate(now.getDate() - 7);
  else if (period === 'month') start.setMonth(now.getMonth() - 1);
  else if (period === 'quarter') start.setMonth(now.getMonth() - 3);
  else if (period === 'year') start.setFullYear(now.getFullYear() - 1);
  else return null; // no period filter
  return { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

// @route GET /api/liaisons/facets?zone=&state=&district=
// Cascading, from real data: pass the zone already picked and only states
// that actually have a liaison in it come back; pass state too and districts
// narrow to that state; pass district as well and hospitals narrow further.
// Departments/organizations/liaison types stay global — nothing about them is
// geographically nested.
exports.getFacets = async (req, res) => {
  try {
    const { zone, state, district } = req.query;
    const rows = await Liaison.findAll({ where: { userId: req.user.id }, attributes: ['state', 'zone', 'district', 'department', 'hospital', 'organization', 'liaisonType'], raw: true });
    const uniq = (key, filterRows = rows) => [...new Set(filterRows.map((r) => r[key]).filter(Boolean))].sort();

    const rowsInZone = zone ? rows.filter((r) => r.zone === zone) : rows;
    const rowsInState = state ? rowsInZone.filter((r) => lc(r.state) === lc(state)) : rowsInZone;
    const rowsInDistrict = district ? rowsInState.filter((r) => lc(r.district) === lc(district)) : rowsInState;

    res.json({
      success: true,
      states: uniq('state', rowsInZone), zones: ZONES, districts: uniq('district', rowsInState), departments: uniq('department'),
      hospitals: uniq('hospital', rowsInDistrict), organizations: uniq('organization'), liaisonTypes: uniq('liaisonType'), orgTypes: ORG_TYPES,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load filters' });
  }
};

// @route GET /api/liaisons
const PAYOUT_STATUS_LABELS = {
  pending_zh_ta: 'ZH/TA Pending', pending_finance: 'Finance Pending', pending_head: 'Head Pending',
  approved: 'Approved', rejected: 'Rejected',
};

// Latest LiaisonPayoutRequest per liaison (by most recent createdAt) — the
// Liaison Tracker shows this so every liaison's approval chain is visible
// as plain columns (ZH/TA/Finance/Head, payment terms, final %) without
// having to open the Liaison Approvals queue separately.
async function latestPayoutByLiaison(req) {
  const rows = await LiaisonPayoutRequest.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
  const byLiaison = new Map();
  for (const r of rows) if (!byLiaison.has(r.liaisonId)) byLiaison.set(r.liaisonId, r);
  return byLiaison;
}

function payoutForApi(p) {
  if (!p) {
    return {
      payoutStatus: null, payoutStatusLabel: 'Not submitted', payoutTenderNumber: null,
      zhStatus: '-', taStatus: '-', financeStatus: '-', headStatus: '-',
      paymentTermsDays: null, finalPercentage: null, requestedPercentage: null,
      payoutDivision: null, poNumber: null, grossProfitPercent: null,
      zhApprovedByName: null, taApprovedByName: null, financeApprovedByName: null, headApprovedByName: null,
      payoutCreatedByName: null, payoutCreatedAt: null,
    };
  }
  return {
    payoutStatus: p.status, payoutStatusLabel: PAYOUT_STATUS_LABELS[p.status] || p.status, payoutTenderNumber: p.tenderNumber,
    zhStatus: p.zhApprovedAt ? 'Approved' : 'Pending', taStatus: p.taApprovedAt ? 'Approved' : 'Pending',
    financeStatus: p.financeApprovedAt ? 'Approved' : (p.status === 'pending_zh_ta' ? '-' : 'Pending'),
    headStatus: p.headApprovedAt ? 'Approved' : (['pending_zh_ta', 'pending_finance'].includes(p.status) ? '-' : 'Pending'),
    paymentTermsDays: p.paymentTermsDays, finalPercentage: p.finalPercentage !== null ? Number(p.finalPercentage) : null,
    requestedPercentage: Number(p.liaisonPercentage),
    // The rest of what the Submit for Approval form itself collects — see
    // components/liaisons/SubmitLiaisonPayoutModal.tsx — so the Liaison
    // Tracker can show (and be searched by) every field of that submission,
    // not just the approval stage.
    payoutDivision: p.division, poNumber: p.poNumber, grossProfitPercent: p.grossProfitPercent !== null ? Number(p.grossProfitPercent) : null,
    zhApprovedByName: p.zhApprovedByName, taApprovedByName: p.taApprovedByName,
    financeApprovedByName: p.financeApprovedByName, headApprovedByName: p.headApprovedByName,
    payoutCreatedByName: p.createdByName, payoutCreatedAt: p.createdAt,
  };
}

exports.list = async (req, res) => {
  try {
    const { search } = req.query;
    const rows = await loadWithStats(req, {});
    const payouts = await latestPayoutByLiaison(req);
    let combined = rows.map(({ liaison, stats }) => ({ ...liaison, ...statsForApi(stats), ...payoutForApi(payouts.get(liaison.id)) }));
    if (search) {
      const s = lc(search);
      // Searches the liaison's own directory fields AND the Submit for
      // Approval form's own fields (tender number, PO number) — so looking
      // up "what's the status of tender X" in the Liaison Tracker works the
      // same whether X is a liaison's name or the tender it was submitted
      // against.
      combined = combined.filter((r) => [r.name, r.organization, r.department, r.hospital, r.state, r.payoutTenderNumber, r.poNumber].some((v) => lc(v).includes(s)));
    }
    res.json({ success: true, data: combined });
  } catch (err) {
    console.error('liaison list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load liaisons' });
  }
};

function statsForApi(stats) {
  return {
    relevantTenders: stats.relevantTenders, successfulConnections: stats.successfulConnections,
    successRate: Math.round(stats.successRate * 100), responseRate: Math.round(stats.responseRate * 100),
    lastInteractionAt: stats.lastInteractionAt, relationshipStrength: stats.strength, interactionCount: stats.interactionCount,
  };
}

// @route POST /api/liaisons  (create)
exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.name || '').trim()) return res.status(400).json({ success: false, message: 'Name is required' });
    const by = await actorName(req);
    const row = await Liaison.create({
      userId: req.user.id, name: b.name.trim(), designation: nz(b.designation), organization: nz(b.organization),
      orgType: ORG_TYPES.some((o) => o.key === b.orgType) ? b.orgType : 'other', department: nz(b.department),
      hospital: nz(b.hospital), state: nz(b.state), city: nz(b.city), zone: ZONES.includes(b.zone) ? b.zone : null, district: nz(b.district),
      liaisonType: nz(b.liaisonType), specialization: nz(b.specialization), phone: nz(b.phone), email: nz(b.email),
      preferredContactMethod: ['phone', 'email', 'whatsapp', 'in_person'].includes(b.preferredContactMethod) ? b.preferredContactMethod : 'phone',
      experienceYears: Number(b.experienceYears) || 0, availability: ['available', 'busy', 'unavailable'].includes(b.availability) ? b.availability : 'available',
      remarks: nz(b.remarks), createdByName: by,
    });
    res.status(201).json({ success: true, data: { ...row.toJSON(), ...statsForApi(statsFor([])) } });
  } catch (err) {
    console.error('liaison create error:', err);
    res.status(500).json({ success: false, message: 'Failed to add liaison' });
  }
};

const EDITABLE = ['name', 'designation', 'organization', 'orgType', 'department', 'hospital', 'state', 'city', 'zone', 'district', 'liaisonType', 'specialization', 'phone', 'email', 'preferredContactMethod', 'experienceYears', 'availability', 'remarks', 'tenderReference', 'product', 'division'];

// @route PUT /api/liaisons/:id
exports.update = async (req, res) => {
  try {
    const row = await Liaison.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Liaison not found' });
    const b = req.body || {};
    EDITABLE.forEach((f) => { if (b[f] !== undefined) row[f] = f === 'experienceYears' ? Number(b[f]) || 0 : nz(typeof b[f] === 'string' ? b[f].trim() : b[f]); });
    await row.save();
    const interactions = await LiaisonInteraction.findAll({ where: { userId: req.user.id, liaisonId: row.id }, raw: true });
    res.json({ success: true, data: { ...row.toJSON(), ...statsForApi(statsFor(interactions)) } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update liaison' });
  }
};

// @route DELETE /api/liaisons/:id
exports.remove = async (req, res) => {
  try {
    const n = await Liaison.destroy({ where: { id: req.params.id, userId: req.user.id } });
    if (!n) return res.status(404).json({ success: false, message: 'Liaison not found' });
    await LiaisonInteraction.destroy({ where: { userId: req.user.id, liaisonId: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete liaison' });
  }
};

// @route GET /api/liaisons/:id  — full profile + timeline
exports.detail = async (req, res) => {
  try {
    const row = await Liaison.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Liaison not found' });
    const interactions = (await LiaisonInteraction.findAll({ where: { userId: req.user.id, liaisonId: row.id }, order: [['occurredOn', 'DESC'], ['id', 'DESC']] })).map((i) => i.toJSON());
    const stats = statsFor(interactions);
    const { score, breakdown } = scoreForRanking(row.toJSON(), stats);

    const insights = [];
    if (stats.categories.size) insights.push({ type: 'opportunity', text: `Strong historical relevance for ${[...stats.categories].slice(0, 2).join(' / ')} tenders${row.state ? ` in ${row.state}` : ''}.` });
    if (interactions.length >= 4) {
      const recent = interactions.filter((i) => daysSince(i.occurredOn) <= 90);
      const older = interactions.filter((i) => daysSince(i.occurredOn) > 90);
      if (recent.length && older.length && recent.length >= older.length) insights.push({ type: 'relationship', text: 'Engagement has increased over the last 90 days.' });
    }
    if (stats.successRate >= 0.6 && stats.relevantTenders >= 3) insights.push({ type: 'recommendation', text: `Consider assigning this liaison to upcoming ${row.district || row.state || 'regional'} tenders${row.hospital ? ` at ${row.hospital}` : ''}.` });
    if (stats.daysSinceLast > 90 && stats.interactionCount > 0) insights.push({ type: 'risk', text: `No interaction has occurred with this liaison for ${stats.daysSinceLast} days.` });
    if (!insights.length) insights.push({ type: 'opportunity', text: 'Not enough logged activity yet for a confident insight — log an interaction to start building this profile.' });

    res.json({ success: true, data: { ...row.toJSON(), ...statsForApi(stats), score, breakdown, tier: tierOf(score), insights, timeline: interactions } });
  } catch (err) {
    console.error('liaison detail error:', err);
    res.status(500).json({ success: false, message: 'Failed to load liaison' });
  }
};

// @route POST /api/liaisons/:id/interactions
exports.addInteraction = async (req, res) => {
  try {
    const liaison = await Liaison.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!liaison) return res.status(404).json({ success: false, message: 'Liaison not found' });
    const b = req.body || {};
    if (!['contacted', 'response', 'meeting', 'follow_up', 'outcome'].includes(b.stage)) return res.status(400).json({ success: false, message: 'Invalid stage' });
    const by = await actorName(req);
    const row = await LiaisonInteraction.create({
      userId: req.user.id, liaisonId: liaison.id, tenderBidNumber: nz(b.tenderBidNumber), tenderTitle: nz(b.tenderTitle),
      organization: nz(b.organization) || liaison.organization, state: nz(b.state) || liaison.state, district: nz(b.district) || liaison.district,
      department: nz(b.department) || liaison.department, hospital: nz(b.hospital) || liaison.hospital,
      productCategory: nz(b.productCategory), tenderCategory: nz(b.tenderCategory), stage: b.stage,
      outcome: ['successful', 'unsuccessful', 'pending'].includes(b.outcome) ? b.outcome : null,
      occurredOn: b.occurredOn || new Date().toISOString().slice(0, 10), note: nz(b.note), createdByName: by,
    });
    res.status(201).json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('liaison addInteraction error:', err);
    res.status(500).json({ success: false, message: 'Failed to log the interaction' });
  }
};

// @route GET /api/liaisons/interactions?liaisonId=&stage=&outcome=&search=&from=&to=
// Tracker > Liaison Tracker — every logged interaction across the whole
// directory in one flat, filterable list (the per-liaison timeline lives on
// the profile modal; this is the "what needs my attention right now" view):
// stuck engagements (no movement in 14+ days and not yet at Outcome) and
// outcomes still sitting at Pending are flagged directly from real data.
const STUCK_AFTER_DAYS = 14;
const monthKeyOf = (d) => new Date(d).toISOString().slice(0, 7);

exports.listInteractions = async (req, res) => {
  try {
    const { liaisonId, stage, outcome, search, from, to } = req.query;
    const where = { userId: req.user.id };
    if (liaisonId) where.liaisonId = liaisonId;
    if (stage) where.stage = stage;
    if (outcome) where.outcome = outcome;
    if (from || to) {
      where.occurredOn = {};
      if (from) where.occurredOn[Op.gte] = from;
      if (to) where.occurredOn[Op.lte] = to;
    }

    const [rows, liaisons] = await Promise.all([
      LiaisonInteraction.findAll({ where, order: [['occurredOn', 'DESC'], ['id', 'DESC']] }),
      Liaison.findAll({ where: { userId: req.user.id }, attributes: ['id', 'name', 'organization', 'state', 'zone'], raw: true }),
    ]);
    const liaisonById = new Map(liaisons.map((l) => [l.id, l]));

    let data = rows.map((r) => {
      const j = r.toJSON();
      const l = liaisonById.get(j.liaisonId);
      const days = daysSince(j.occurredOn);
      const stuck = j.stage !== 'outcome' && days >= STUCK_AFTER_DAYS;
      return {
        ...j, liaisonName: l?.name || 'Unknown liaison', liaisonOrganization: l?.organization || null,
        liaisonState: l?.state || null, liaisonZone: l?.zone || null, daysSince: days, stuck, pending: j.outcome === 'pending',
      };
    });

    if (search) {
      const s = lc(search);
      data = data.filter((r) => [r.liaisonName, r.liaisonOrganization, r.tenderBidNumber, r.tenderTitle, r.department, r.hospital, r.note].some((v) => lc(v).includes(s)));
    }

    const thisMonth = monthKeyOf(new Date());
    const stats = {
      total: rows.length,
      pending: rows.filter((r) => r.outcome === 'pending').length,
      stuck: data.filter((r) => r.stuck).length,
      successfulThisMonth: rows.filter((r) => r.outcome === 'successful' && monthKeyOf(r.occurredOn) === thisMonth).length,
    };
    res.json({ success: true, data, total: data.length, stats, liaisons: liaisons.map((l) => ({ id: l.id, name: l.name })) });
  } catch (err) {
    console.error('liaison listInteractions error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the liaison tracker' });
  }
};

// @route GET /api/liaisons/recommend?search=&state=&zone=&district=&orgType=&organization=&department=&hospital=&tenderCategory=&productCategory=
exports.recommend = async (req, res) => {
  try {
    const q = req.query || {};
    const rows = await loadWithStats(req, {});
    let scored = rows.map(({ liaison, stats }) => {
      const { score, breakdown } = scoreForRecommendation(liaison, stats, q);
      return { ...liaison, ...statsForApi(stats), score, breakdown, tier: tierOf(score), why: explain(liaison, stats, q) };
    });
    if (q.search) {
      const s = lc(q.search);
      scored = scored.filter((l) => [l.name, l.organization, l.department, l.hospital, l.state].some((v) => lc(v).includes(s)));
    }
    if (q.availability) scored = scored.filter((l) => l.availability === q.availability);
    if (q.liaisonType) scored = scored.filter((l) => l.liaisonType === q.liaisonType);
    if (q.minExperience) scored = scored.filter((l) => l.experienceYears >= Number(q.minExperience));
    scored.sort((a, b) => b.score - a.score);

    const byZone = {};
    ZONES.forEach((z) => { byZone[z] = scored.filter((l) => l.zone === z).slice(0, 5); });
    const byOrgType = {};
    ORG_TYPES.forEach((o) => { byOrgType[o.key] = scored.filter((l) => l.orgType === o.key).slice(0, 5); });

    res.json({ success: true, data: scored, top: scored.slice(0, 6), byZone, byOrgType, total: scored.length });
  } catch (err) {
    console.error('liaison recommend error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute recommendations' });
  }
};

// @route GET /api/liaisons/rank?state=&zone=&district=&organization=&hospital=&department=&tenderCategory=&liaisonType=&period=
exports.rank = async (req, res) => {
  try {
    const q = req.query || {};
    const rows = await loadWithStats(req, {}, periodToRange(q.period, q.from, q.to));
    let scored = rows.map(({ liaison, stats }) => {
      const { score, breakdown } = scoreForRanking(liaison, stats);
      return { ...liaison, ...statsForApi(stats), score, breakdown, tier: tierOf(score) };
    });
    if (q.state) scored = scored.filter((l) => lc(l.state) === lc(q.state));
    if (q.zone) scored = scored.filter((l) => l.zone === q.zone);
    if (q.district) scored = scored.filter((l) => lc(l.district) === lc(q.district));
    if (q.organization) scored = scored.filter((l) => lc(l.organization).includes(lc(q.organization)));
    if (q.hospital) scored = scored.filter((l) => lc(l.hospital).includes(lc(q.hospital)));
    if (q.department) scored = scored.filter((l) => lc(l.department).includes(lc(q.department)));
    if (q.liaisonType) scored = scored.filter((l) => l.liaisonType === q.liaisonType);
    scored.sort((a, b) => b.score - a.score);
    scored.forEach((l, i) => { l.rank = i + 1; });

    const zoneSummary = ZONES.map((z) => {
      const inZone = scored.filter((l) => l.zone === z);
      const active = inZone.filter((l) => l.availability !== 'unavailable' && l.interactionCount > 0);
      return {
        zone: z, totalLiaisons: inZone.length, activeLiaisons: active.length,
        avgAiScore: inZone.length ? Math.round(inZone.reduce((s, l) => s + l.score, 0) / inZone.length) : 0,
        successfulConnections: inZone.reduce((s, l) => s + l.successfulConnections, 0),
        avgResponseRate: inZone.length ? Math.round(inZone.reduce((s, l) => s + l.responseRate, 0) / inZone.length) : 0,
        totalRelevantTenders: inZone.reduce((s, l) => s + l.relevantTenders, 0),
      };
    });

    const orgGroups = new Map();
    scored.forEach((l) => { const k = l.organization || 'Unassigned'; if (!orgGroups.has(k)) orgGroups.set(k, []); orgGroups.get(k).push(l); });
    const orgSummary = [...orgGroups.entries()].map(([organization, list]) => {
      const top = list.slice().sort((a, b) => b.score - a.score)[0];
      return {
        organization, topLiaison: top.name, relevantTenders: list.reduce((s, l) => s + l.relevantTenders, 0),
        successRate: list.length ? Math.round(list.reduce((s, l) => s + l.successRate, 0) / list.length) : 0, aiScore: top.score,
      };
    }).sort((a, b) => b.aiScore - a.aiScore).slice(0, 12);

    const hospitalRows = scored.filter((l) => l.hospital).map((l) => ({
      hospital: l.hospital, location: [l.district, l.state].filter(Boolean).join(', '), liaison: l.name, department: l.department,
      relevantTenders: l.relevantTenders, successRate: l.successRate, lastInteraction: l.lastInteractionAt,
    }));

    res.json({ success: true, data: scored, total: scored.length, zoneSummary, orgSummary, hospitalRows });
  } catch (err) {
    console.error('liaison rank error:', err);
    res.status(500).json({ success: false, message: 'Failed to compute ranking' });
  }
};

exports.exportExcel = safeHandler('liaison ranking export', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.rank, req, { clear: ['state', 'zone', 'district', 'organization', 'hospital', 'department', 'liaisonType'], paged: false, pick: (payload) => payload.data });
  await sendWorkbook(res, {
    title: 'Liaison Ranking', filename: 'Liaison_Ranking', mode, applied,
    columns: [
      { header: 'Rank', key: 'rank', width: 8 },
      { header: 'Liaison', key: 'name', width: 24 },
      { header: 'Organization', key: 'organization', width: 28 },
      { header: 'State', key: 'state', width: 16 },
      { header: 'Zone', key: 'zone', width: 10 },
      { header: 'Relevant Tenders', key: 'relevantTenders', width: 16, type: 'number' },
      { header: 'Connections', key: 'successfulConnections', width: 14, type: 'number' },
      { header: 'Success Rate %', key: 'successRate', width: 14, type: 'number' },
      { header: 'Response Rate %', key: 'responseRate', width: 15, type: 'number' },
      { header: 'AI Score', key: 'score', width: 10, type: 'number' },
    ],
    rows,
  });
});
