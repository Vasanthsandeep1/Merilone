'use strict';
// Shared price-intelligence helpers for Suggested Pricing (tender details
// popup) and the Pricing Tracker page.
//
// Source data: the `contracts` table (awarded GeM orders). Only contracts
// that carry a bid_no can be tied to a tender, and it's the tender
// (gem_tenders) that gives us the product category (sub_cat) and quantity —
// so every price here is a per-unit price: total_value / quantity.
//
// GeM data is noisy (₹0 orders, a ₹10 "analyzer", multi-item bids where one
// line's quantity divides the whole order value), so each category's prices
// are filtered to within 10x of that category's median before any stats.
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

const OUTLIER_FACTOR = 10;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// contract_date arrives in three shapes — "2025-11-28", "21/2/2026 09:53"
// and "04-Mar-2026" — and is sometimes NULL. Returns epoch ms or null.
// (SQL equivalent: CONTRACT_DT in controllers/ordersController.js.)
const parseContractDate = (s) => {
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) return Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  return null;
};

// Linear-interpolated percentile of an ascending-sorted array.
const percentile = (sorted, p) => {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

const sortedPrices = (rows) => rows.map((r) => r.unitPrice).sort((a, b) => a - b);

// Seller names differ only by suffix/punctuation across sources
// ("MERIL DIAGNOSTICS PRIVATE LIMITED" vs "Meril Diagnostics Pvt. Ltd.").
const normalizeCompany = (s) => (s || '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(private|pvt|limited|ltd|llp|inc|co|company|the)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Every priced award, optionally narrowed to one category / dept. Rows are
// returned outlier-filtered per category and sorted oldest-first.
const loadPricedAwards = async ({ category = null, dept = null, excludeBid = null } = {}) => {
  const where = ['g.quantity + 0 > 0', 'c.total_value + 0 > 0', "g.sub_cat IS NOT NULL AND g.sub_cat <> ''"];
  const replacements = {};
  if (category) { where.push('g.sub_cat = :category'); replacements.category = category; }
  if (dept) { where.push('LOWER(COALESCE(c.dept, g.dept)) = :dept'); replacements.dept = dept.toLowerCase(); }
  if (excludeBid) { where.push('c.bid_no <> :excludeBid'); replacements.excludeBid = excludeBid; }

  const raw = await sequelize.query(
    `SELECT c.bid_no AS bidNo, c.seller_name AS sellerName, c.contract_date AS contractDate,
            c.order_status AS orderStatus, c.total_value + 0 AS totalValue,
            g.quantity + 0 AS quantity, g.sub_cat AS category, g.department AS buyer,
            LOWER(COALESCE(c.dept, g.dept)) AS dept
       FROM contracts c
       JOIN gem_tenders g ON g.bid_number = c.bid_no
      WHERE ${where.join(' AND ')}`,
    { replacements, type: QueryTypes.SELECT }
  );

  const byCategory = new Map();
  for (const r of raw) {
    const row = {
      bidNo: r.bidNo,
      sellerName: (r.sellerName || 'Unknown seller').trim(),
      ts: parseContractDate(r.contractDate),
      orderStatus: r.orderStatus || null,
      totalValue: Number(r.totalValue),
      quantity: Number(r.quantity),
      unitPrice: Number(r.totalValue) / Number(r.quantity),
      category: r.category,
      buyer: r.buyer || null,
      dept: r.dept || null,
    };
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push(row);
  }

  const out = [];
  for (const rows of byCategory.values()) {
    const median = percentile(sortedPrices(rows), 0.5);
    for (const r of rows) {
      if (r.unitPrice >= median / OUTLIER_FACTOR && r.unitPrice <= median * OUTLIER_FACTOR) out.push(r);
    }
  }
  // Undated awards sort first so "latest" always means a real date.
  return out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
};

// P25–P75 band ("what most winners charged"), median, and a confidence
// level driven purely by how many awards back it.
const priceBand = (rows) => {
  const prices = sortedPrices(rows);
  if (!prices.length) return { low: null, median: null, high: null, confidence: null };
  return {
    low: Math.round(percentile(prices, 0.25)),
    median: Math.round(percentile(prices, 0.5)),
    high: Math.round(percentile(prices, 0.75)),
    confidence: prices.length >= 10 ? 'High' : prices.length >= 4 ? 'Medium' : 'Low',
  };
};

// Price direction: median of the newer half of dated awards vs the older
// half. Needs >= 4 dated awards, otherwise it's noise and returns null.
const priceTrend = (rows) => {
  const dated = rows.filter((r) => r.ts != null);
  if (dated.length < 4) return null;
  const mid = Math.floor(dated.length / 2);
  const older = percentile(sortedPrices(dated.slice(0, mid)), 0.5);
  const newer = percentile(sortedPrices(dated.slice(mid)), 0.5);
  return older ? Number((((newer - older) / older) * 100).toFixed(1)) : null;
};

// Per-seller stats, cheapest (lowest least-quoted) first. `rows` must be
// sorted oldest-first, as loadPricedAwards returns them.
const competitorStats = (rows) => {
  const bySeller = new Map();
  for (const r of rows) {
    if (!bySeller.has(r.sellerName)) bySeller.set(r.sellerName, []);
    bySeller.get(r.sellerName).push(r);
  }
  return [...bySeller.entries()].map(([name, list]) => {
    const prices = list.map((r) => r.unitPrice);
    const first = list[0].unitPrice;
    const last = list[list.length - 1];
    return {
      name,
      contracts: list.length,
      winShare: Number(((list.length / rows.length) * 100).toFixed(1)),
      averagePrice: Math.round(prices.reduce((s, v) => s + v, 0) / prices.length),
      lastPrice: Math.round(last.unitPrice),
      lastAwardDate: last.ts,
      leastPrice: Math.round(Math.min(...prices)),
      // Needs at least two awards to say anything about a seller's trend.
      inflationRate: list.length > 1 ? Number((((last.unitPrice - first) / first) * 100).toFixed(2)) : null,
    };
  }).sort((a, b) => a.leastPrice - b.leastPrice);
};

module.exports = {
  parseContractDate, percentile, normalizeCompany, loadPricedAwards, priceBand, priceTrend, competitorStats,
};
