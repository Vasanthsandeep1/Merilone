const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

// Order Management — Order Overview, GeM Contracts (order register) and
// Carting Dashboard, all read from the `contracts` table (awarded GeM
// orders).
//
// That table only carries id, bid_no, total_value, state, contract_date,
// order_status, seller_name and dept. Anything richer (product category,
// quantity, buyer department, unit price) comes from joining the tender on
// bid_no — only possible for orders that recorded one.
//
// "Meril" orders are identified by seller name (MERIL DIAGNOSTICS / MERIL
// ENDO SURGERY), since there's no meril_or_others column in this schema.

const MERIL_SQL = "c.seller_name LIKE '%meril%'";
const VALUE = 'COALESCE(c.total_value + 0, 0)';

// contract_date is stored in three text formats ("2025-11-28",
// "21/2/2026 09:53", "04-Mar-2026") — see utils/pricing.js parseContractDate.
const CONTRACT_DT = `COALESCE(STR_TO_DATE(c.contract_date, '%Y-%m-%d'),
  STR_TO_DATE(c.contract_date, '%d/%m/%Y %H:%i'), STR_TO_DATE(c.contract_date, '%d-%b-%Y'))`;

const DEPT_SQL = "LOWER(c.dept) IN ('diagno', 'endo')";

// GeM's raw order statuses grouped into lifecycle stages, in flow order.
// `open` = still needs action from seller or buyer.
const STAGES = [
  { key: 'awaiting_confirmation', label: 'Awaiting seller confirmation', open: true, statuses: ['Waiting for Seller Confirmation'] },
  { key: 'accepted', label: 'Accepted', open: true, statuses: ['Order Accepted'] },
  { key: 'in_fulfilment', label: 'In fulfilment', open: true, statuses: ['Fullfillment in Progress'] },
  { key: 'awaiting_payment', label: 'Awaiting payment', open: true, statuses: ['Waiting for Seller Payment'] },
  { key: 'paid', label: 'Paid', open: false, statuses: ['Order Paid'] },
  { key: 'completed', label: 'Completed', open: false, statuses: ['Order Completed'] },
  { key: 'cancelled', label: 'Cancelled', open: false, statuses: ['Order Cancelled', 'Cancellation Requested by Buyer'] },
  { key: 'unrecorded', label: 'Status not recorded', open: false, statuses: [] },
];
const KNOWN_STATUSES = STAGES.flatMap((s) => s.statuses);
const OPEN_STATUSES = STAGES.filter((s) => s.open).flatMap((s) => s.statuses);

const stageOf = (status) => STAGES.find((s) => s.statuses.includes(status)) || STAGES[STAGES.length - 1];

const stageCondition = (key, replacements) => {
  if (key === 'open') {
    replacements.openStageStatuses = OPEN_STATUSES;
    return 'c.order_status IN (:openStageStatuses)';
  }
  const stage = STAGES.find((s) => s.key === key);
  if (!stage) return null;
  if (key === 'unrecorded') {
    replacements.knownStatuses = KNOWN_STATUSES;
    return '(c.order_status IS NULL OR c.order_status NOT IN (:knownStatuses))';
  }
  replacements[`stage_${key}`] = stage.statuses;
  return `c.order_status IN (:stage_${key})`;
};

const toUrlId = (bidNumber) => (bidNumber || '').split('/').join('_');

// Filters shared by the overview and the order register.
function buildOrderFilters(query) {
  const { search, state, dept, stage, seller, dateFrom, dateTo, merilOnly } = query;
  const conditions = [DEPT_SQL];
  const replacements = {};

  if (search) {
    conditions.push('(c.seller_name LIKE :search OR c.bid_no LIKE :search OR c.state LIKE :search)');
    replacements.search = `%${search}%`;
  }
  if (state) { conditions.push('c.state = :state'); replacements.state = state; }
  if (dept) { conditions.push('LOWER(c.dept) = :dept'); replacements.dept = dept.toLowerCase(); }
  if (seller) { conditions.push('c.seller_name = :seller'); replacements.seller = seller; }
  if (stage) {
    const cond = stageCondition(stage, replacements);
    if (cond) conditions.push(cond);
  }
  if (merilOnly === 'true') conditions.push(MERIL_SQL);
  if (dateFrom) { conditions.push(`${CONTRACT_DT} >= :dateFrom`); replacements.dateFrom = dateFrom; }
  if (dateTo) { conditions.push(`${CONTRACT_DT} < DATE_ADD(:dateTo, INTERVAL 1 DAY)`); replacements.dateTo = dateTo; }

  return { whereSql: conditions.join(' AND '), replacements };
}

const ORDER_COLUMNS = `c.id, c.bid_no AS bidNo, c.seller_name AS seller, c.state, LOWER(c.dept) AS dept,
  c.order_status AS orderStatus, ${VALUE} AS value, DATE_FORMAT(${CONTRACT_DT}, '%Y-%m-%d') AS date,
  (${MERIL_SQL}) AS isMeril,
  g.sub_cat AS category, g.quantity + 0 AS quantity, g.department AS buyer`;

const shapeOrder = (r) => {
  const quantity = Number(r.quantity) || null;
  const stage = stageOf(r.orderStatus);
  return {
    id: r.id,
    bidNo: r.bidNo || null,
    urlId: r.bidNo ? toUrlId(r.bidNo) : null,
    seller: r.seller,
    state: r.state,
    dept: r.dept,
    orderStatus: r.orderStatus,
    stage: stage.key,
    stageLabel: stage.label,
    isOpen: stage.open,
    value: Number(r.value),
    date: r.date,
    isMeril: !!Number(r.isMeril),
    category: r.category || null,
    quantity,
    buyer: r.buyer || null,
    unitPrice: quantity ? Math.round(Number(r.value) / quantity) : null,
  };
};

// ---- Order Overview ----

// @route GET /api/orders/overview
exports.getOverview = async (req, res) => {
  try {
    const { whereSql, replacements } = buildOrderFilters(req.query);
    replacements.openStatuses = OPEN_STATUSES;
    const q = (sql) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

    const [[totals], statusRows, monthly, topStates, topSellers, attention] = await Promise.all([
      q(`SELECT COUNT(*) AS orders, SUM(${VALUE}) AS value,
                SUM(${MERIL_SQL}) AS merilOrders, SUM(CASE WHEN ${MERIL_SQL} THEN ${VALUE} ELSE 0 END) AS merilValue,
                COUNT(DISTINCT c.seller_name) AS sellers
           FROM contracts c WHERE ${whereSql}`),
      q(`SELECT c.order_status AS status, COUNT(*) AS orders, SUM(${VALUE}) AS value
           FROM contracts c WHERE ${whereSql} GROUP BY c.order_status`),
      q(`SELECT DATE_FORMAT(${CONTRACT_DT}, '%Y-%m') AS month, COUNT(*) AS orders, SUM(${VALUE}) AS value,
                SUM(CASE WHEN ${MERIL_SQL} THEN ${VALUE} ELSE 0 END) AS merilValue
           FROM contracts c WHERE ${whereSql} AND ${CONTRACT_DT} IS NOT NULL
          GROUP BY month ORDER BY month`),
      q(`SELECT c.state, COUNT(*) AS orders, SUM(${VALUE}) AS value
           FROM contracts c WHERE ${whereSql} AND c.state IS NOT NULL AND c.state <> ''
          GROUP BY c.state ORDER BY value DESC LIMIT 10`),
      q(`SELECT c.seller_name AS seller, COUNT(*) AS orders, SUM(${VALUE}) AS value, MAX(${MERIL_SQL}) AS isMeril
           FROM contracts c WHERE ${whereSql} AND c.seller_name IS NOT NULL
          GROUP BY c.seller_name ORDER BY value DESC LIMIT 10`),
      // Open orders, oldest first — the ones most likely stuck.
      q(`SELECT ${ORDER_COLUMNS}, DATEDIFF(CURDATE(), ${CONTRACT_DT}) AS ageDays
           FROM contracts c LEFT JOIN gem_tenders g ON g.bid_number = c.bid_no
          WHERE ${whereSql} AND c.order_status IN (:openStatuses) AND ${CONTRACT_DT} IS NOT NULL
          ORDER BY ${CONTRACT_DT} ASC LIMIT 10`),
    ]);

    const byStage = new Map(STAGES.map((s) => [s.key, { stage: s.key, label: s.label, open: s.open, orders: 0, value: 0 }]));
    for (const r of statusRows) {
      const agg = byStage.get(stageOf(r.status).key);
      agg.orders += Number(r.orders);
      agg.value += Number(r.value) || 0;
    }
    const pipeline = [...byStage.values()];
    const sum = (keys, field) => pipeline.filter((p) => keys(p)).reduce((s, p) => s + p[field], 0);

    const orders = Number(totals.orders) || 0;
    const value = Number(totals.value) || 0;
    const recorded = sum((p) => p.stage !== 'unrecorded', 'orders');
    const cancelled = byStage.get('cancelled').orders;

    res.json({
      success: true,
      data: {
        kpis: {
          orders,
          value,
          avgOrderValue: orders ? Math.round(value / orders) : 0,
          sellers: Number(totals.sellers) || 0,
          openOrders: sum((p) => p.open, 'orders'),
          openValue: sum((p) => p.open, 'value'),
          completedOrders: byStage.get('completed').orders,
          // Only orders with a recorded status can be judged cancelled or not.
          cancelRate: recorded ? Number(((cancelled / recorded) * 100).toFixed(1)) : null,
          recordedStatusPct: orders ? Number(((recorded / orders) * 100).toFixed(1)) : 0,
          merilOrders: Number(totals.merilOrders) || 0,
          merilValue: Number(totals.merilValue) || 0,
        },
        pipeline,
        monthly: monthly.map((m) => ({ month: m.month, orders: Number(m.orders), value: Number(m.value) || 0, merilValue: Number(m.merilValue) || 0 })),
        topStates: topStates.map((s) => ({ state: s.state, orders: Number(s.orders), value: Number(s.value) || 0 })),
        topSellers: topSellers.map((s) => ({
          seller: s.seller, orders: Number(s.orders), value: Number(s.value) || 0,
          share: value ? Number(((Number(s.value) / value) * 100).toFixed(1)) : 0, isMeril: !!Number(s.isMeril),
        })),
        needsAttention: attention.map((r) => ({ ...shapeOrder(r), ageDays: Number(r.ageDays) })),
      },
    });
  } catch (err) {
    console.error('orders getOverview error:', err);
    res.status(500).json({ success: false, message: 'Failed to load order overview' });
  }
};

// ---- GeM Contracts (order register) ----

const SORTS = {
  'date-desc': `${CONTRACT_DT} IS NULL, ${CONTRACT_DT} DESC, c.id DESC`,
  'date-asc': `${CONTRACT_DT} IS NULL, ${CONTRACT_DT} ASC, c.id ASC`,
  'value-desc': `${VALUE} DESC`,
  'value-asc': `${VALUE} ASC`,
};

// @route GET /api/orders/gem-contracts
exports.getGemContracts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const { whereSql, replacements } = buildOrderFilters(req.query);
    const orderBy = SORTS[req.query.sort] || SORTS['date-desc'];

    const [rows, [summary]] = await Promise.all([
      sequelize.query(
        `SELECT ${ORDER_COLUMNS}
           FROM contracts c LEFT JOIN gem_tenders g ON g.bid_number = c.bid_no
          WHERE ${whereSql} ORDER BY ${orderBy} LIMIT :limit OFFSET :offset`,
        { replacements: { ...replacements, limit, offset: (page - 1) * limit }, type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT COUNT(*) AS total, SUM(${VALUE}) AS totalValue FROM contracts c WHERE ${whereSql}`,
        { replacements, type: QueryTypes.SELECT },
      ),
    ]);

    const total = Number(summary.total);
    res.json({
      success: true,
      data: rows.map(shapeOrder),
      total,
      totalValue: Number(summary.totalValue) || 0,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('getGemContracts error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch contracts' });
  }
};

// @route GET /api/orders/gem-contracts/filters
// Dropdown options for the register: states and lifecycle stages.
exports.getContractFilters = async (req, res) => {
  try {
    const states = await sequelize.query(
      `SELECT DISTINCT c.state FROM contracts c WHERE c.state IS NOT NULL AND c.state <> '' AND ${DEPT_SQL} ORDER BY c.state`,
      { type: QueryTypes.SELECT },
    );
    res.json({
      success: true,
      data: {
        states: states.map((r) => r.state),
        stages: [{ key: 'open', label: 'All open orders' }, ...STAGES.map(({ key, label }) => ({ key, label }))],
      },
    });
  } catch (err) {
    console.error('getContractFilters error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch filters' });
  }
};

const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// @route GET /api/orders/gem-contracts/export — CSV of the filtered register.
exports.exportGemContracts = async (req, res) => {
  try {
    const { whereSql, replacements } = buildOrderFilters(req.query);
    const orderBy = SORTS[req.query.sort] || SORTS['date-desc'];
    const rows = await sequelize.query(
      `SELECT ${ORDER_COLUMNS}
         FROM contracts c LEFT JOIN gem_tenders g ON g.bid_number = c.bid_no
        WHERE ${whereSql} ORDER BY ${orderBy} LIMIT 50000`,
      { replacements, type: QueryTypes.SELECT },
    );
    const header = ['Order Date', 'Bid No', 'Seller', 'State / Ministry', 'Division', 'GeM Status', 'Stage', 'Order Value', 'Category', 'Quantity', 'Unit Price', 'Buyer'];
    const lines = rows.map(shapeOrder).map((o) => [
      o.date, o.bidNo, o.seller, o.state, o.dept, o.orderStatus, o.stageLabel, o.value, o.category, o.quantity, o.unitPrice, o.buyer,
    ].map(csvCell).join(','));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gem-orders-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${[header.join(','), ...lines].join('\n')}`);
  } catch (err) {
    console.error('exportGemContracts error:', err);
    res.status(500).json({ success: false, message: 'Failed to export contracts' });
  }
};

// @route GET /api/orders/gem-contracts/:id
// One order plus context: the seller's track record and any other orders
// placed against the same bid.
exports.getContractDetail = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [row] = await sequelize.query(
      `SELECT ${ORDER_COLUMNS}, g.items, g.end_date AS bidEndDate
         FROM contracts c LEFT JOIN gem_tenders g ON g.bid_number = c.bid_no WHERE c.id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT },
    );
    if (!row) return res.status(404).json({ success: false, message: 'Order not found' });

    const [[sellerStats], sellerStatuses, sameBid] = await Promise.all([
      sequelize.query(
        `SELECT COUNT(*) AS orders, SUM(${VALUE}) AS value, COUNT(DISTINCT c.state) AS states,
                MIN(${CONTRACT_DT}) AS firstOrder, MAX(${CONTRACT_DT}) AS lastOrder
           FROM contracts c WHERE c.seller_name = :seller AND ${DEPT_SQL}`,
        { replacements: { seller: row.seller }, type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT c.order_status AS status, COUNT(*) AS n FROM contracts c
          WHERE c.seller_name = :seller AND ${DEPT_SQL} GROUP BY c.order_status`,
        { replacements: { seller: row.seller }, type: QueryTypes.SELECT },
      ),
      row.bidNo
        ? sequelize.query(
          `SELECT ${ORDER_COLUMNS} FROM contracts c LEFT JOIN gem_tenders g ON g.bid_number = c.bid_no
            WHERE c.bid_no = :bidNo AND c.id <> :id ORDER BY ${CONTRACT_DT} DESC LIMIT 20`,
          { replacements: { bidNo: row.bidNo, id }, type: QueryTypes.SELECT },
        )
        : [],
    ]);

    // Seller reliability: share of their status-recorded orders that were
    // completed/paid vs cancelled.
    let completed = 0; let cancelled = 0; let recorded = 0;
    for (const s of sellerStatuses) {
      const stage = stageOf(s.status).key;
      if (stage === 'unrecorded') continue;
      recorded += Number(s.n);
      if (stage === 'completed' || stage === 'paid') completed += Number(s.n);
      if (stage === 'cancelled') cancelled += Number(s.n);
    }

    res.json({
      success: true,
      data: {
        order: { ...shapeOrder(row), items: row.items || null, bidEndDate: row.bidEndDate || null },
        stages: STAGES.filter((s) => s.key !== 'unrecorded' && s.key !== 'cancelled').map(({ key, label }) => ({ key, label })),
        seller: {
          name: row.seller,
          orders: Number(sellerStats.orders),
          value: Number(sellerStats.value) || 0,
          states: Number(sellerStats.states),
          firstOrder: sellerStats.firstOrder,
          lastOrder: sellerStats.lastOrder,
          completionRate: recorded ? Number(((completed / recorded) * 100).toFixed(1)) : null,
          cancelRate: recorded ? Number(((cancelled / recorded) * 100).toFixed(1)) : null,
        },
        sameBidOrders: sameBid.map(shapeOrder),
      },
    });
  } catch (err) {
    console.error('getContractDetail error:', err);
    res.status(500).json({ success: false, message: 'Failed to load order' });
  }
};

// ---- Carting Dashboard ----
// Meril vs Others order value by state and month. Filters are all
// parameterized.
function buildCartingFilters(query) {
  const { dept, month, year, seller, state } = query;
  const conditions = [DEPT_SQL];
  const replacements = {};

  if (dept) { conditions.push('LOWER(c.dept) = :dept'); replacements.dept = dept.toLowerCase(); }
  if (year) { conditions.push(`YEAR(${CONTRACT_DT}) = :year`); replacements.year = Number(year); }
  if (month) { conditions.push(`MONTH(${CONTRACT_DT}) = :month`); replacements.month = Number(month); }
  if (seller) { conditions.push('c.seller_name = :seller'); replacements.seller = seller; }
  if (state) { conditions.push('c.state = :state'); replacements.state = state; }

  return { whereSql: conditions.join(' AND '), replacements };
}

// @route GET /api/orders/carting/sellers
exports.getCartingSellers = async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT DISTINCT c.seller_name FROM contracts c WHERE c.seller_name IS NOT NULL AND c.seller_name <> '' AND ${DEPT_SQL} ORDER BY c.seller_name`,
      { type: QueryTypes.SELECT },
    );
    res.json({ success: true, data: rows.map((r) => r.seller_name) });
  } catch (err) {
    console.error('getCartingSellers error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch sellers' });
  }
};

// @route GET /api/orders/carting/states
exports.getCartingStates = async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT DISTINCT c.state FROM contracts c WHERE c.state IS NOT NULL AND c.state <> '' AND ${DEPT_SQL} ORDER BY c.state`,
      { type: QueryTypes.SELECT },
    );
    res.json({ success: true, data: rows.map((r) => r.state) });
  } catch (err) {
    console.error('getCartingStates error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch states' });
  }
};

// @route GET /api/orders/carting/years
exports.getCartingYears = async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT DISTINCT YEAR(${CONTRACT_DT}) AS y FROM contracts c WHERE ${CONTRACT_DT} IS NOT NULL AND ${DEPT_SQL} ORDER BY y DESC`,
      { type: QueryTypes.SELECT },
    );
    res.json({ success: true, data: rows.map((r) => String(r.y)) });
  } catch (err) {
    console.error('getCartingYears error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch years' });
  }
};

// @route GET /api/orders/carting/kpi
exports.getCartingKpi = async (req, res) => {
  try {
    const { whereSql, replacements } = buildCartingFilters(req.query);
    const [row] = await sequelize.query(
      `SELECT SUM(${VALUE}) AS total, SUM(CASE WHEN ${MERIL_SQL} THEN ${VALUE} ELSE 0 END) AS meril
         FROM contracts c WHERE ${whereSql}`,
      { replacements, type: QueryTypes.SELECT },
    );
    const total = Number(row.total) || 0;
    const meril = Number(row.meril) || 0;
    res.json({ success: true, data: { total, meril, others: total - meril } });
  } catch (err) {
    console.error('getCartingKpi error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch carting KPIs' });
  }
};

// @route GET /api/orders/carting/pivot
exports.getCartingPivot = async (req, res) => {
  try {
    const { whereSql, replacements } = buildCartingFilters(req.query);
    const rows = await sequelize.query(
      `SELECT c.state, DATE_FORMAT(${CONTRACT_DT}, '%b %Y') AS month, DATE_FORMAT(${CONTRACT_DT}, '%Y-%m') AS monthKey,
              SUM(${VALUE}) AS total, SUM(CASE WHEN ${MERIL_SQL} THEN ${VALUE} ELSE 0 END) AS meril
         FROM contracts c
        WHERE ${CONTRACT_DT} IS NOT NULL AND c.state IS NOT NULL AND c.state <> '' AND ${whereSql}
        GROUP BY c.state, month, monthKey
        ORDER BY c.state ASC, monthKey DESC`,
      { replacements, type: QueryTypes.SELECT },
    );
    res.json({
      success: true,
      data: rows.map((r) => ({
        state: r.state, month: r.month, monthKey: r.monthKey,
        total: Number(r.total) || 0, meril: Number(r.meril) || 0, others: (Number(r.total) || 0) - (Number(r.meril) || 0),
      })),
    });
  } catch (err) {
    console.error('getCartingPivot error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch carting pivot' });
  }
};

// @route GET /api/orders/carting/map
exports.getCartingMap = async (req, res) => {
  try {
    const { whereSql, replacements } = buildCartingFilters(req.query);
    const rows = await sequelize.query(
      `SELECT c.state, SUM(${VALUE}) AS total, SUM(CASE WHEN ${MERIL_SQL} THEN ${VALUE} ELSE 0 END) AS meril
         FROM contracts c
        WHERE c.state IS NOT NULL AND c.state <> '' AND ${whereSql}
        GROUP BY c.state ORDER BY total DESC`,
      { replacements, type: QueryTypes.SELECT },
    );
    res.json({
      success: true,
      data: rows.map((r) => ({
        state: r.state, total: Number(r.total) || 0, meril: Number(r.meril) || 0, others: (Number(r.total) || 0) - (Number(r.meril) || 0),
      })),
    });
  } catch (err) {
    console.error('getCartingMap error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch carting map data' });
  }
};

// Shared helpers for code that shapes the same contract rows.
exports.helpers = { ORDER_COLUMNS, CONTRACT_DT, DEPT_SQL, shapeOrder };
