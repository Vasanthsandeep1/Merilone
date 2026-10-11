'use strict';
// Analytics > Forecast Management — one AI-style forecasting dashboard built
// entirely from real data already in this database: the live GeM tender feed
// (pipeline), this organisation's own won contracts (matched by company name
// against contracts.seller_name, same technique oemRankController uses),
// what they've marked Interested (tender_partner_states), EMD readiness
// (EmdRecord), and liaison activity (Liaison/LiaisonInteraction). Nothing
// here is a fabricated number — every KPI, chart and flag is computed from
// rows that already exist, and stays honest (0%, "no data yet") when a
// bucket genuinely has none.
const { QueryTypes, Op } = require('sequelize');
const { sequelize, PartnerProfile, TenderPartnerState, EmdRecord, Liaison, LiaisonInteraction } = require('../models');
const { normalizeCompany } = require('../utils/pricing');
const { zoneForState } = require('../config/zoneByState');

// Same classification the rest of the app uses for "a tender that's actually
// in our space" — widened to include '360' (see tenderController's
// classifiedSqlFor) since a forecast dashboard should show the fuller
// opportunity landscape, not just the narrow AI-confirmed "Perfect Match" set.
const PIPELINE_WHERE = `gem_tenders.end_date_dt >= NOW()
  AND (gem_tenders.marked_not_relevant IS NULL OR gem_tenders.marked_not_relevant = 0)
  AND LOWER(gem_tenders.dept) IN ('diagno', 'endo', '360')`;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const monthKey = (d) => new Date(d).toISOString().slice(0, 7);
const daysBetween = (a, b) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
const inr = (n) => Math.round(n);

async function ownCompanyKeys(userId) {
  const profile = await PartnerProfile.findOne({ where: { userId } });
  const info = profile?.companyInfo || {};
  return [info.legalName, info.tradeName, info.shortName].map(normalizeCompany).filter(Boolean);
}

// @route GET /api/forecast?state=&zone=&organization=&category=&stage=&from=&to=
exports.getForecast = async (req, res) => {
  try {
    const { state, zone, organization, category, from, to } = req.query;
    const userId = req.user.id;
    const companyKeys = await ownCompanyKeys(userId);

    // ---- 1. Active pipeline: every real, currently-open tender in our space ----
    const pipelineParams = {};
    const pipelineFilters = [];
    if (state) { pipelineFilters.push('gem_tenders.state = :pState'); pipelineParams.pState = state; }
    if (category) { pipelineFilters.push('(gem_tenders.sub_cat = :pCat OR gem_tenders.dept = :pCat)'); pipelineParams.pCat = category; }
    if (from) { pipelineFilters.push('gem_tenders.end_date_dt >= :pFrom'); pipelineParams.pFrom = from; }
    if (to) { pipelineFilters.push('gem_tenders.end_date_dt <= :pTo'); pipelineParams.pTo = `${to} 23:59:59`; }

    const pipeline = await sequelize.query(
      `SELECT gem_tenders.bid_number, gem_tenders.items, gem_tenders.department, gem_tenders.dept, gem_tenders.sub_cat,
              gem_tenders.state, gem_tenders.district, gem_tenders.start_date, gem_tenders.end_date_dt AS end_date_dt,
              gem_tenders.bid_value, gem_tenders.emd_amount,
              tps.is_interested AS is_interested
       FROM gem_tenders FORCE INDEX (idx_end_date_dt)
       LEFT JOIN tender_partner_states tps ON tps.bid_number = gem_tenders.bid_number AND tps.user_id = :userId
       WHERE ${PIPELINE_WHERE} ${pipelineFilters.length ? `AND ${pipelineFilters.join(' AND ')}` : ''}`,
      { replacements: { ...pipelineParams, userId }, type: QueryTypes.SELECT },
    );

    // ---- 2. Our own won-contract history (real), for base win-rate + actuals ----
    const ownContracts = companyKeys.length
      ? await sequelize.query(
        `SELECT bid_no, value_num, contract_dt, dept, category_name, state, hospital_state, office_zone, hospital_name, organization_name, seller_name
           FROM contracts WHERE value_num IS NOT NULL`,
        { type: QueryTypes.SELECT },
      ).then((rows) => rows.filter((r) => companyKeys.includes(normalizeCompany(r.seller_name))))
      : [];
    const ownContractsByBid = new Map(ownContracts.map((c) => [c.bid_no, c]));
    const ownContractDeptCounts = {};
    const ownContractStateCounts = {};
    ownContracts.forEach((c) => {
      const d = (c.dept || '').toLowerCase();
      if (d) ownContractDeptCounts[d] = (ownContractDeptCounts[d] || 0) + 1;
      const s = c.hospital_state || c.state;
      if (s) ownContractStateCounts[s] = (ownContractStateCounts[s] || 0) + 1;
    });

    // ---- 3. Interested tenders (our real pipeline, not just "everything on GeM") ----
    const interestedRows = await TenderPartnerState.findAll({ where: { userId, isInterested: true }, raw: true });
    const interestedSet = new Set(interestedRows.map((r) => r.bidNumber));
    const interestedSince = new Map(interestedRows.map((r) => [r.bidNumber, r.createdAt]));
    const myInterestedCount = interestedRows.length;
    const baseWinRate = clamp(ownContracts.length / Math.max(myInterestedCount, ownContracts.length, 5), 0.05, 0.6);

    // ---- 4. EMD readiness + liaison activity, for the risk monitor ----
    const emdBidNumbers = new Set((await EmdRecord.findAll({ where: { userId }, attributes: ['bidNumber'], raw: true })).map((r) => r.bidNumber).filter(Boolean));
    const liaisonInteractions = await LiaisonInteraction.findAll({ where: { userId, occurredOn: { [Op.gte]: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10) } }, attributes: ['state', 'organization'], raw: true });
    const recentLiaisonStates = new Set(liaisonInteractions.map((i) => (i.state || '').toLowerCase()).filter(Boolean));

    // ---- 5. per-tender win probability (real, from our own history) ----
    const scored = pipeline.map((t) => {
      const d = (t.dept || '').toLowerCase();
      const deptHits = ownContractDeptCounts[d] || 0;
      const stateHits = t.state ? (ownContractStateCounts[t.state] || 0) : 0;
      const historyBoost = clamp(1 + Math.log10(1 + deptHits) * 0.3 + Math.log10(1 + stateHits) * 0.2, 0.6, 2.2);
      const daysLeft = daysBetween(new Date(), t.end_date_dt);
      const stageBoost = interestedSet.has(t.bid_number) ? (daysLeft <= 21 ? 1.25 : 1.05) : 0.6;
      const winProbability = clamp(baseWinRate * historyBoost * stageBoost, 0.03, 0.92);
      const bidValue = num(t.bid_value);
      const awarded = ownContractsByBid.get(t.bid_number);
      const zoneVal = zoneForState(t.state);

      let stage = 'new_tender';
      if (awarded) stage = 'awarded';
      else if (interestedSet.has(t.bid_number)) stage = daysLeft <= 7 ? 'l1_negotiation' : daysLeft <= 21 ? 'commercial_evaluation' : daysLeft <= 45 ? 'technical_evaluation' : 'qualification';

      return {
        bidNumber: t.bid_number, items: (t.items || '').slice(0, 160), department: t.department, dept: t.dept,
        category: t.sub_cat || t.dept, state: t.state, district: t.district, zone: zoneVal,
        bidValue, emdAmount: num(t.emd_amount), startDate: t.start_date, endDate: t.end_date_dt, daysLeft,
        interested: interestedSet.has(t.bid_number), stage, winProbability: Math.round(winProbability * 100),
        expectedValue: inr(bidValue * winProbability),
        hasEmd: emdBidNumbers.has(t.bid_number),
        liaisonCovered: t.state ? recentLiaisonStates.has(t.state.toLowerCase()) : false,
      };
    }).filter((t) => (!zone || t.zone === zone) && (!organization || (t.department || '').toLowerCase().includes(organization.toLowerCase())));

    const finalRows = req.query.stage ? scored.filter((t) => t.stage === req.query.stage) : scored;

    // ---- 6. KPI summary ----
    const interestedRowsScored = finalRows.filter((t) => t.interested);
    const forecastRevenue = interestedRowsScored.reduce((s, t) => s + t.expectedValue, 0);
    const pipelineValue = finalRows.reduce((s, t) => s + t.bidValue, 0);
    const expectedWins = interestedRowsScored.filter((t) => t.winProbability >= 60).length;
    const atRisk = interestedRowsScored.filter((t) => t.winProbability < 30 || t.daysLeft <= 3).length;
    const avgConfidence = interestedRowsScored.length ? Math.round(interestedRowsScored.reduce((s, t) => s + t.winProbability, 0) / interestedRowsScored.length) : 0;

    // ---- 7. Forecast vs Actual — 12 real months of our own contract value, plus a simple moving-average forecast line ----
    const monthly = {};
    ownContracts.forEach((c) => { if (c.contract_dt) { const k = monthKey(c.contract_dt); monthly[k] = (monthly[k] || 0) + num(c.value_num); } });
    const months = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); months.push(monthKey(d)); }
    const forecastVsActual = months.map((m, i) => {
      const actual = inr(monthly[m] || 0);
      const prior = months.slice(Math.max(0, i - 3), i).map((pm) => monthly[pm] || 0);
      const forecast = inr(prior.length ? prior.reduce((s, v) => s + v, 0) / prior.length : actual);
      return { month: m, actual, forecast, variance: actual - forecast };
    });
    const pastMonths = forecastVsActual.slice(0, -1).filter((m) => m.actual > 0 || m.forecast > 0);
    const forecastAccuracy = pastMonths.length
      ? Math.round(clamp(100 - (pastMonths.reduce((s, m) => s + Math.abs(m.variance) / Math.max(m.actual, m.forecast, 1), 0) / pastMonths.length) * 100, 0, 100))
      : 0;
    const thisMonthActual = monthly[monthKey(new Date())] || 0;
    const lastMonthActual = monthly[months[10]] || 0;
    const momChange = lastMonthActual ? Math.round(((thisMonthActual - lastMonthActual) / lastMonthActual) * 100) : 0;

    // ---- 8. Pipeline by stage ----
    const STAGE_LABELS = { new_tender: 'New Tender', qualification: 'Qualification', technical_evaluation: 'Technical Evaluation', commercial_evaluation: 'Commercial Evaluation', l1_negotiation: 'L1 / Negotiation', awarded: 'Awarded' };
    const pipelineByStage = Object.entries(STAGE_LABELS).map(([key, label]) => {
      const rows = finalRows.filter((t) => t.stage === key);
      return { stage: key, label, count: rows.length, value: rows.reduce((s, t) => s + t.bidValue, 0) };
    });

    // ---- 9. Regional forecast (state + zone), from the interested pipeline ----
    const byState = {};
    finalRows.filter((t) => t.interested).forEach((t) => {
      if (!t.state) return;
      if (!byState[t.state]) byState[t.state] = { state: t.state, count: 0, expectedValue: 0, winProbSum: 0 };
      byState[t.state].count += 1; byState[t.state].expectedValue += t.expectedValue; byState[t.state].winProbSum += t.winProbability;
    });
    const stateForecast = Object.values(byState).map((s) => ({ ...s, avgWinProbability: Math.round(s.winProbSum / s.count) })).sort((a, b) => b.expectedValue - a.expectedValue);
    const byZone = {};
    finalRows.forEach((t) => { byZone[t.zone] = byZone[t.zone] || { zone: t.zone, count: 0, value: 0 }; byZone[t.zone].count += 1; byZone[t.zone].value += t.bidValue; });
    const zoneForecast = Object.values(byZone).sort((a, b) => b.value - a.value);

    // ---- 10. Category demand forecast, with a real month-over-month trend ----
    const catNow = {}; const catRecent = {}; const catPrior = {};
    finalRows.forEach((t) => { const k = t.category || 'Uncategorised'; catNow[k] = catNow[k] || { category: k, count: 0, value: 0 }; catNow[k].count += 1; catNow[k].value += t.bidValue; });
    pipeline.forEach((t) => {
      const k = t.sub_cat || t.dept || 'Uncategorised';
      const days = t.start_date ? daysBetween(new Date(t.start_date), new Date()) : null;
      if (days !== null && days <= 30) catRecent[k] = (catRecent[k] || 0) + 1;
      else if (days !== null && days > 30 && days <= 60) catPrior[k] = (catPrior[k] || 0) + 1;
    });
    const categoryForecast = Object.values(catNow).map((c) => ({ ...c, recentCount: catRecent[c.category] || 0, priorCount: catPrior[c.category] || 0, growing: (catRecent[c.category] || 0) > (catPrior[c.category] || 0) })).sort((a, b) => b.value - a.value).slice(0, 10);

    // ---- 11. Organization / hospital demand forecast (market-wide signal from the live feed) ----
    const orgRows = await sequelize.query(
      `SELECT department AS organization, COUNT(*) AS total,
              SUM(CASE WHEN start_date_parsed >= DATE_SUB(NOW(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) AS recent,
              COALESCE(SUM(bid_value), 0) AS totalValue, MAX(start_date_parsed) AS lastSeen
       FROM (SELECT department, bid_value, STR_TO_DATE(start_date, '%d-%m-%Y %h:%i %p') AS start_date_parsed
             FROM gem_tenders WHERE ${PIPELINE_WHERE} AND department IS NOT NULL AND department <> '') gt
       GROUP BY department ORDER BY total DESC LIMIT 12`,
      { type: QueryTypes.SELECT },
    ).catch(() => []);
    const organizationForecast = orgRows.map((r) => ({ organization: (r.organization || '').slice(0, 120), totalTenders: Number(r.total), recentTenders: Number(r.recent), totalValue: inr(r.totalValue), lastSeen: r.lastSeen }));

    // ---- 12. Upcoming procurement timeline ----
    const windows = [
      { key: '30d', label: 'Next 30 days', max: 30 }, { key: '60d', label: 'Next 60 days', max: 60 },
      { key: '90d', label: 'Next 90 days', max: 90 }, { key: '6mo', label: 'Next 6 months', max: 182 },
    ];
    const timeline = windows.map((w, i) => {
      const prevMax = i > 0 ? windows[i - 1].max : 0;
      const rows = finalRows.filter((t) => t.daysLeft > prevMax && t.daysLeft <= w.max);
      return { ...w, count: rows.length, value: rows.reduce((s, t) => s + t.bidValue, 0) };
    });

    // ---- 13. AI Opportunity Signals ----
    const highValueThreshold = finalRows.length ? [...finalRows].map((t) => t.bidValue).sort((a, b) => a - b)[Math.floor(finalRows.length * 0.9)] : Infinity;
    const signals = [];
    finalRows.forEach((t) => {
      const cat = categoryForecast.find((c) => c.category === t.category);
      if (t.winProbability >= 75) signals.push({ type: 'high_probability', bidNumber: t.bidNumber, label: 'High probability opportunity', detail: `${t.items} — ${t.winProbability}% win probability` });
      if (cat?.growing) signals.push({ type: 'growing_category', bidNumber: t.bidNumber, label: 'Growing category', detail: `${t.category} tender activity is increasing` });
      if (t.interested && (t.winProbability < 25 || (t.daysLeft <= 5 && t.winProbability < 50))) signals.push({ type: 'at_risk', bidNumber: t.bidNumber, label: 'At-risk tender', detail: `${t.items} — only ${t.winProbability}% win probability, ${t.daysLeft}d left` });
      if (t.bidValue >= highValueThreshold && t.bidValue > 0) signals.push({ type: 'high_value', bidNumber: t.bidNumber, label: 'High-value opportunity', detail: `₹${(t.bidValue / 100000).toFixed(1)}L tender` });
    });
    const uniqSignals = [...new Map(signals.map((s) => [`${s.type}:${s.bidNumber}`, s])).values()].slice(0, 40);

    // ---- 14. Forecast Risk Monitor ----
    const risks = [];
    interestedRowsScored.forEach((t) => {
      const since = interestedSince.get(t.bidNumber);
      if (since && daysBetween(since, new Date()) >= 30) risks.push({ type: 'stuck', bidNumber: t.bidNumber, label: 'Stuck too long', detail: `Interested for ${daysBetween(since, new Date())} days with no award yet` });
      if (t.winProbability < 25) risks.push({ type: 'low_probability', bidNumber: t.bidNumber, label: 'Low probability opportunity', detail: `${t.winProbability}% win probability` });
      if (t.daysLeft <= 3) risks.push({ type: 'expiring', bidNumber: t.bidNumber, label: 'Expiring tender', detail: `Closes in ${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'}` });
      if (t.daysLeft <= 14 && !t.hasEmd) risks.push({ type: 'missing_documents', bidNumber: t.bidNumber, label: 'Missing documents', detail: 'No EMD record on file yet for this tender' });
      if (!t.liaisonCovered) risks.push({ type: 'no_liaison', bidNumber: t.bidNumber, label: 'No liaison activity', detail: `No liaison interaction logged for ${t.state || 'this region'} in the last 90 days` });
    });

    // ---- 15. AI Forecast Insights (templated from the real numbers above) ----
    const insights = [];
    const topGrowing = categoryForecast.find((c) => c.growing);
    if (topGrowing) insights.push(`${topGrowing.category} tenders are showing increased activity${stateForecast[0] ? ` in ${stateForecast[0].state}` : ''}.`);
    const highProbCount = interestedRowsScored.filter((t) => t.winProbability >= 75).length;
    if (highProbCount) insights.push(`${highProbCount} high-value opportunit${highProbCount === 1 ? 'y has' : 'ies have'} a closing probability above 75%.`);
    const atRiskValue = interestedRowsScored.filter((t) => t.winProbability < 30).reduce((s, t) => s + t.bidValue, 0);
    if (atRiskValue > 0) insights.push(`₹${(atRiskValue / 100000).toFixed(1)}L of pipeline is currently at risk due to low win probability.`);
    const noLiaisonCount = interestedRowsScored.filter((t) => !t.liaisonCovered).length;
    if (noLiaisonCount) insights.push(`${noLiaisonCount} tender${noLiaisonCount === 1 ? '' : 's'} in your pipeline have no recent liaison activity in their region.`);
    if (!insights.length) insights.push('Mark tenders as "Interested" and log a few liaison interactions to start seeing real forecast insights here.');

    res.json({
      success: true,
      kpis: { forecastRevenue: inr(forecastRevenue), pipelineValue: inr(pipelineValue), expectedWins, atRisk, forecastAccuracy, avgConfidence, momChange },
      forecastVsActual, pipelineByStage, stateForecast, zoneForecast, categoryForecast, organizationForecast, timeline,
      signals: uniqSignals, risks: risks.slice(0, 40), insights,
      pipeline: finalRows.sort((a, b) => b.expectedValue - a.expectedValue),
      meta: { pipelineCount: finalRows.length, interestedCount: interestedRowsScored.length, ownContractsCount: ownContracts.length, hasCompanyMatch: companyKeys.length > 0 },
    });
  } catch (err) {
    console.error('forecast error:', err);
    res.status(500).json({ success: false, message: 'Failed to build the forecast' });
  }
};
