const { QueryTypes, Op } = require('sequelize');
const {
  sequelize, User, PartnerProfile, PartnerProductSelection, CompanyCategory, DealerAuthRequest,
} = require('../models');
const { normalizeCompany } = require('../utils/pricing');

// Product Management > OEM Ranking (reseller side) — ranks the OEMs on this
// platform a reseller could request authorization from, purely from what is on
// record: how responsive/generous they are with authorizations already granted,
// how many products/categories they offer, how complete/verified their company
// profile is, and — where their company name matches a GeM seller — their own
// award track record. Mirrors Distributor Ranking's shape (score, tier, stars,
// breakdown, shortlist/select) but scores OEMs instead of the SAP distributor list.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const companyLabel = (p) => { const info = p?.companyInfo || {}; return info.tradeName || info.legalName || info.shortName || null; };

// GeM sellers matching an OEM's own company name(s) — same idea as pricing.js's ownCompany,
// but for every OEM at once so the whole ranking is built with a handful of queries.
async function sellerEvidenceByCompany() {
  const rows = await sequelize.query(
    `SELECT seller_name AS s, COUNT(*) AS n, COALESCE(SUM(value_num), 0) AS v, COUNT(DISTINCT hospital_state) AS states, MAX(contract_dt) AS last
       FROM contracts WHERE seller_name IS NOT NULL AND seller_name <> '' GROUP BY seller_name`,
    { type: QueryTypes.SELECT },
  );
  const map = new Map();
  for (const r of rows) {
    const key = normalizeCompany(r.s);
    if (!key) continue;
    map.set(key, { contracts: Number(r.n), value: Number(r.v), states: Number(r.states), last: r.last ? new Date(r.last) : null });
  }
  return map;
}

const monthsSince = (d) => (d ? (Date.now() - d.getTime()) / (30.44 * 86400000) : null);
const tierOf = (score, hasAnyRecord) => (!hasAnyRecord ? 'New' : score >= 75 ? 'Platinum' : score >= 55 ? 'Gold' : score >= 35 ? 'Silver' : 'Bronze');
const starsOf = (score) => clamp(Math.round((score / 20) * 2) / 2, 0.5, 5);

/**
 * Score out of 100:
 *   authorisation record  35  approved authorizations granted, approval rate, how fast they decide
 *   catalogue             20  how many products / categories they have listed
 *   profile standing      20  verified PAN/CIN/GeM seller id, profile completeness
 *   GeM track record      25  their own awarded contracts (by matching company name), if any
 */
function scoreOem({ received, approvedFast, categories, products, verifiedCount, hasLogo, hasDescription, gem }) {
  const total = received.length;
  const approved = received.filter((r) => r.status === 'approved');
  const approvalRate = total ? approved.length / total : null;
  const authScore = total === 0 ? 0 : clamp(approvalRate * 22, 0, 22) + clamp(Math.log10(1 + approved.length) * 8, 0, 8) + (approvedFast ? 5 : 0);
  const catalogue = clamp(Math.min(categories, 8) / 8 * 10 + Math.min(products, 20) / 20 * 10, 0, 20);
  const standing = clamp(verifiedCount * 5, 0, 15) + (hasLogo ? 3 : 0) + (hasDescription ? 2 : 0);
  const gemScore = gem ? clamp(10 * Math.log10(1 + gem.contracts) + 5 * Math.log10(1 + gem.value / 1e5), 0, 25) : 0;
  const raw = authScore + catalogue + standing + gemScore;
  const hasAnyRecord = total > 0 || products > 0 || !!gem || verifiedCount > 0;
  const score = Math.round(raw);
  return {
    score: clamp(score, 0, 100),
    breakdown: {
      authorisations: Math.round(authScore), catalogue: Math.round(catalogue), standing: Math.round(standing), gem: Math.round(gemScore),
      max: { authorisations: 35, catalogue: 20, standing: 20, gem: 25 },
    },
    facts: {
      requestsReceived: total, requestsApproved: approved.length, approvalRate: approvalRate === null ? null : Math.round(approvalRate * 100),
      categories, products, gemContracts: gem ? gem.contracts : 0, gemValue: gem ? Math.round(gem.value) : 0,
      lastGemContract: gem && gem.last ? gem.last.toISOString().slice(0, 10) : null,
    },
    hasAnyRecord,
  };
}

// @route GET /api/oem-rank?category=&state=&tier=&q=&sort=score|requests|products&page=&limit=
exports.rank = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const { category, tier, q, sort = 'score' } = req.query;

    const [oems, allSelections, allRequests, sellerEv] = await Promise.all([
      User.findAll({ where: { userType: 'partner', partnerType: 'oem', profileSubmitted: true, id: { [Op.ne]: req.user.id } }, include: [{ model: PartnerProfile, as: 'partnerProfile' }] }),
      PartnerProductSelection.findAll({ include: [{ model: CompanyCategory, as: 'category' }] }),
      DealerAuthRequest.findAll({ attributes: ['toUserId', 'status', 'createdAt', 'decidedAt'], raw: true }),
      sellerEvidenceByCompany(),
    ]);

    const selByProfile = new Map();
    for (const s of allSelections) { if (!selByProfile.has(s.profileId)) selByProfile.set(s.profileId, []); selByProfile.get(s.profileId).push(s); }
    const reqByOem = new Map();
    for (const r of allRequests) { if (!reqByOem.has(r.toUserId)) reqByOem.set(r.toUserId, []); reqByOem.get(r.toUserId).push(r); }

    const needle = String(q || '').trim().toLowerCase();
    const catNeedle = String(category || '').trim().toLowerCase();

    const out = [];
    for (const u of oems) {
      const p = u.partnerProfile;
      const name = companyLabel(p) || u.name;
      if (needle && !`${name} ${u.email}`.toLowerCase().includes(needle)) continue;
      const selections = p ? (selByProfile.get(p.id) || []) : [];
      const categories = new Set(selections.map((s) => s.category && s.category.name).filter(Boolean));
      if (catNeedle && ![...categories].some((c) => c.toLowerCase().includes(catNeedle))) continue;
      const received = (reqByOem.get(u.id) || []);
      const decided = received.filter((r) => r.decidedAt);
      const avgHrs = decided.length ? decided.reduce((s, r) => s + (new Date(r.decidedAt) - new Date(r.createdAt)) / 3.6e6, 0) / decided.length : null;
      const info = p?.companyInfo || {};
      const verifiedCount = [p?.companyPanVerified, p?.companyCinVerified, p?.gemSellerIdVerified].filter(Boolean).length;
      const gemKeys = [info.legalName, info.tradeName].map(normalizeCompany).filter(Boolean);
      const gem = gemKeys.map((k) => sellerEv.get(k)).find(Boolean) || null;

      const sc = scoreOem({
        received, approvedFast: avgHrs !== null && avgHrs <= 48, categories: categories.size, products: selections.length,
        verifiedCount, hasLogo: !!info.logoUrl, hasDescription: !!(info.description && info.description.length > 20), gem,
      });
      const t = tierOf(sc.score, sc.hasAnyRecord);
      if (tier && t !== tier) continue;

      out.push({
        userId: u.id, name, email: u.email, categories: [...categories],
        logoUrl: info.logoUrl || null, verified: verifiedCount >= 2,
        score: sc.score, stars: starsOf(sc.score), tier: t, breakdown: sc.breakdown, facts: { ...sc.facts, avgResponseHours: avgHrs === null ? null : Math.round(avgHrs) },
      });
    }

    const key = { score: (r) => r.score, requests: (r) => r.facts.requestsApproved, products: (r) => r.facts.products }[sort] || ((r) => r.score);
    out.sort((a, b) => key(b) - key(a) || b.score - a.score || a.name.localeCompare(b.name));
    out.forEach((r, i) => { r.rank = i + 1; });

    const tiers = { Platinum: 0, Gold: 0, Silver: 0, Bronze: 0, New: 0 };
    out.forEach((r) => { tiers[r.tier] += 1; });
    res.json({ success: true, data: out.slice((page - 1) * limit, page * limit), total: out.length, page, limit, summary: { tiers } });
  } catch (err) {
    console.error('oem rank error:', err);
    res.status(500).json({ success: false, message: 'Failed to rank OEMs' });
  }
};

// @route GET /api/oem-rank/categories — every category any OEM has products in, for the filter dropdown
exports.categories = async (req, res) => {
  try {
    const rows = await CompanyCategory.findAll({ attributes: ['id', 'name'], raw: true });
    res.json({ success: true, data: rows.map((r) => r.name).filter((v, i, a) => a.indexOf(v) === i).sort() });
  } catch (err) {
    console.error('oem rank categories error:', err);
    res.status(500).json({ success: false, message: 'Failed to load categories' });
  }
};
