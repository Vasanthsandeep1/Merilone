'use strict';
// Pricing Tracker — per-category price intelligence from awarded GeM
// contracts. All price maths lives in utils/pricing.js (shared with the
// tender details "Suggested Pricing" popup); this controller only shapes it
// into an overview (every tracked category) and a single-category drilldown.
const { QueryTypes } = require('sequelize');
const { sequelize, PartnerProfile } = require('../models');
const {
  percentile, normalizeCompany, loadPricedAwards, priceBand, priceTrend, competitorStats,
} = require('../utils/pricing');

const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');

const DEPTS = ['diagno', 'endo'];

// Same "open, relevant" definition the Tenders list uses (tenderController's
// CLASSIFIED_SQL + RELEVANT_SQL), plus still accepting bids.
const OPEN_TENDER_SQL = `LOWER(g.dept) IN ('diagno', 'endo')
  AND (g.ra_no IS NULL OR TRIM(g.ra_no) = '') AND g.perfect_cat = 1
  AND (g.marked_not_relevant IS NULL OR g.marked_not_relevant = 0)
  AND g.end_date_dt > NOW()`;

const toUrlId = (bidNumber) => (bidNumber || '').split('/').join('_');

// The signed-in partner's own company, so its awards can be highlighted.
// Matches GeM seller names against the profile's legal/trade name.
const ownCompany = async (userId) => {
  const profile = await PartnerProfile.findOne({ where: { userId }, attributes: ['companyInfo'] });
  const info = profile?.companyInfo || {};
  const name = info.legalName || info.tradeName || null;
  const keys = [info.legalName, info.tradeName].map(normalizeCompany).filter(Boolean);
  return { name, keys };
};

const matchOwn = (sellerName, keys) => keys.includes(normalizeCompany(sellerName));

const parseDept = (d) => (DEPTS.includes((d || '').toLowerCase()) ? d.toLowerCase() : null);

const groupBy = (rows, key) => {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r[key])) map.set(r[key], []);
    map.get(r[key]).push(r);
  }
  return map;
};

const mostCommon = (values) => {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
};

// @route GET /api/pricing-tracker?dept=diagno|endo
exports.getOverview = async (req, res) => {
  try {
    const dept = parseDept(req.query.dept);
    const [rows, own] = await Promise.all([loadPricedAwards({ dept }), ownCompany(req.user.id)]);
    const byCategory = groupBy(rows, 'category');
    const categories = [...byCategory.keys()];

    const openCounts = categories.length
      ? await sequelize.query(
        `SELECT g.sub_cat AS category, COUNT(*) AS n FROM gem_tenders g
          WHERE g.sub_cat IN (:categories) AND ${OPEN_TENDER_SQL} GROUP BY g.sub_cat`,
        { replacements: { categories }, type: QueryTypes.SELECT }
      )
      : [];
    const openByCategory = new Map(openCounts.map((r) => [r.category, Number(r.n)]));

    const list = [...byCategory.entries()].map(([category, list]) => {
      const band = priceBand(list);
      const latest = list[list.length - 1];
      const ownRows = own.keys.length ? list.filter((r) => matchOwn(r.sellerName, own.keys)) : [];
      const ownLatest = ownRows[ownRows.length - 1];
      return {
        category,
        dept: mostCommon(list.map((r) => r.dept)),
        contracts: list.length,
        sellers: new Set(list.map((r) => r.sellerName)).size,
        ...band,
        trendPct: priceTrend(list),
        latestPrice: Math.round(latest.unitPrice),
        latestSeller: latest.sellerName,
        latestDate: latest.ts,
        openTenders: openByCategory.get(category) || 0,
        yourLastPrice: ownLatest ? Math.round(ownLatest.unitPrice) : null,
        // How far your last win sat from the market median (+ = above).
        yourVsMedianPct: ownLatest && band.median
          ? Number((((ownLatest.unitPrice - band.median) / band.median) * 100).toFixed(1))
          : null,
      };
    }).sort((a, b) => b.contracts - a.contracts);

    res.json({
      success: true,
      data: {
        company: own.name,
        kpis: {
          categories: list.length,
          contracts: rows.length,
          sellers: new Set(rows.map((r) => r.sellerName)).size,
          openTenders: list.reduce((s, c) => s + c.openTenders, 0),
          yourAwards: own.keys.length ? rows.filter((r) => matchOwn(r.sellerName, own.keys)).length : 0,
        },
        categories: list,
      },
    });
  } catch (err) {
    console.error('pricingTracker getOverview error:', err);
    res.status(500).json({ success: false, message: 'Failed to load pricing tracker' });
  }
};

// @route GET /api/pricing-tracker/category?name=<sub_cat>
exports.getCategoryDetail = async (req, res) => {
  try {
    const category = (req.query.name || '').toString();
    if (!category) return res.status(400).json({ success: false, message: 'Category name is required' });

    const [rows, own] = await Promise.all([loadPricedAwards({ category }), ownCompany(req.user.id)]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'No priced contracts for this category' });

    // Monthly series for the trend chart: median + P25–P75 band per month.
    const byMonth = new Map();
    for (const r of rows) {
      if (r.ts == null) continue;
      const d = new Date(r.ts);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(r.unitPrice);
    }
    const series = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, prices]) => {
      prices.sort((a, b) => a - b);
      return {
        month,
        median: Math.round(percentile(prices, 0.5)),
        low: Math.round(percentile(prices, 0.25)),
        high: Math.round(percentile(prices, 0.75)),
        awards: prices.length,
      };
    });

    const band = priceBand(rows);
    const competitors = competitorStats(rows).map((c) => ({ ...c, isYou: own.keys.length > 0 && matchOwn(c.name, own.keys) }));

    const openTenders = await sequelize.query(
      `SELECT g.bid_number AS bidNumber, g.items, g.department, g.quantity, g.end_date AS endDate
         FROM gem_tenders g
        WHERE g.sub_cat = :category AND ${OPEN_TENDER_SQL}
        ORDER BY g.end_date_dt ASC LIMIT 25`,
      { replacements: { category }, type: QueryTypes.SELECT }
    );

    const latest = rows[rows.length - 1];
    res.json({
      success: true,
      data: {
        category,
        dept: mostCommon(rows.map((r) => r.dept)),
        company: own.name,
        summary: {
          ...band,
          contracts: rows.length,
          sellers: competitors.length,
          trendPct: priceTrend(rows),
          minPrice: Math.round(Math.min(...rows.map((r) => r.unitPrice))),
          maxPrice: Math.round(Math.max(...rows.map((r) => r.unitPrice))),
          latest: { price: Math.round(latest.unitPrice), seller: latest.sellerName, date: latest.ts },
        },
        series,
        competitors,
        awards: [...rows].reverse().map((r) => ({
          bidNumber: r.bidNo,
          urlId: toUrlId(r.bidNo),
          date: r.ts,
          seller: r.sellerName,
          isYou: own.keys.length > 0 && matchOwn(r.sellerName, own.keys),
          buyer: r.buyer,
          quantity: r.quantity,
          unitPrice: Math.round(r.unitPrice),
          totalValue: Math.round(r.totalValue),
          orderStatus: r.orderStatus,
        })),
        openTenders: openTenders.map((t) => {
          const qty = Number(t.quantity) || null;
          return {
            bidNumber: t.bidNumber,
            urlId: toUrlId(t.bidNumber),
            items: t.items,
            buyer: t.department,
            quantity: qty,
            endDate: t.endDate,
            // What this tender is worth if priced at the market median.
            estimatedValue: qty && band.median ? qty * band.median : null,
          };
        }),
      },
    });
  } catch (err) {
    console.error('pricingTracker getCategoryDetail error:', err);
    res.status(500).json({ success: false, message: 'Failed to load category pricing' });
  }
};

// @route GET /api/pricing-tracker/export?mode=all|filtered&dept=diagno|endo
exports.exportExcel = safeHandler('pricing tracker', async (req, res) => {
  const needle = req.query.mode === 'all' ? '' : String(req.query.search || '').trim().toLowerCase();
  const { rows, mode, applied } = await collectRows(exports.getOverview, req, {
    clear: ['dept', 'search'], paged: false,
    pick: (p) => ((p.data && p.data.categories) || []).filter((c) => !needle || String(c.category).toLowerCase().includes(needle)),
  });
  await sendWorkbook(res, {
    title: 'Pricing Tracker', rows, mode, applied,
    columns: [
      { header: 'Category', key: 'category', width: 40 },
      { header: 'Department', key: 'dept', width: 12 },
      { header: 'Awarded Contracts', key: 'contracts', width: 16, type: 'number' },
      { header: 'Sellers', key: 'sellers', width: 10, type: 'number' },
      { header: 'Low (25th pct)', key: 'low', width: 14, type: 'money' },
      { header: 'Median', key: 'median', width: 14, type: 'money' },
      { header: 'High (75th pct)', key: 'high', width: 14, type: 'money' },
      { header: 'Confidence', key: 'confidence', width: 12 },
      { header: 'Trend %', key: 'trendPct', width: 10 },
      { header: 'Latest Price', key: 'latestPrice', width: 14, type: 'money' },
      { header: 'Latest Seller', key: 'latestSeller', width: 30 },
      { header: 'Latest Award Date', get: (r) => (r.latestDate ? new Date(r.latestDate) : null), width: 16, type: 'date' },
      { header: 'Open Tenders', key: 'openTenders', width: 13, type: 'number' },
      { header: 'Your Last Price', key: 'yourLastPrice', width: 14, type: 'money' },
      { header: 'Your vs Median %', key: 'yourVsMedianPct', width: 16 },
    ],
  });
});
