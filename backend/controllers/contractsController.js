const ExcelJS = require('exceljs');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

// GeM Contracts — clone of the original automation site's contracts page
// (backend/src/controllers/contracts.controller.js there). Reads the full
// GeM `contracts` table (see scripts/migrate_contracts_full.js for how the
// 40-column table gets into this database).
//
// Differences from the original, on purpose:
//  - no per-user department scope (this app has no such scoping) — every
//    Diagno/Endo contract is visible;
//  - contract_date is stored as text 'd/m/Y H:i', so sorting/filtering goes
//    through STR_TO_DATE (the original sorted the raw string, which orders
//    by day-of-month, not by date);
//  - `download_link` / `C_json_path` hold paths on the scraper machine, so
//    they're never returned — the Download column is `pdf_link` (GeM's own
//    contract PDF URL);
//  - "Meril DB" comes from the meril_db column instead of a dealers lookup.

// Parsed, indexed copies of the text contract_date / total_value columns
// (stored generated columns — see scripts/migrate_contracts_full.js).
const CONTRACT_DT = 'c.contract_dt';
const VALUE = 'c.value_num';
const QTY = "CAST(REPLACE(IFNULL(c.ordered_quantity, '0'), ',', '') AS DECIMAL(12,2))";

const LIST_COLUMNS = `c.id, c.contract_no, c.bid_no, c.buying_mode, c.order_status, c.contract_date, c.zonal_head,
  c.hospital_name, c.organization_name, c.hospital_state, c.hospital_location, c.seller_name, c.seller_state,
  c.seller_location, c.seller_contact_no, c.seller_email, c.meril_db, c.meril_or_others, c.category_name,
  c.product, c.brand, c.model, c.decode_code, c.company_name, c.ordered_quantity, c.unit_price, c.price,
  c.total_value, c.buyer_department, c.buyer_dept_org, c.buyer_designation, c.office_zone, c.pdf_link, c.dept`;

function buildWhere(q) {
  const conds = ["c.dept IN ('diagno', 'endo')"];
  const r = {};
  const add = (sql, key, val) => { conds.push(sql); if (key) r[key] = val; };

  if (q.search) {
    add(`(c.contract_no LIKE :s OR c.product LIKE :s OR c.brand LIKE :s OR c.organization_name LIKE :s OR c.hospital_name LIKE :s
          OR c.seller_name LIKE :s OR c.category_name LIKE :s OR c.company_name LIKE :s OR c.decode_code LIKE :s)`, 's', `%${q.search}%`);
  }
  if (q.referenceNo) add('(c.contract_no LIKE :ref OR c.bid_no LIKE :ref)', 'ref', `%${q.referenceNo}%`);
  // hospital_state is the buyer's geographic state; `state` holds the buying ministry.
  if (q.state && q.state !== 'All States') add('UPPER(c.hospital_state) = UPPER(:state)', 'state', q.state);
  if (q.departmentType && q.departmentType !== 'All') add('c.dept = :dept', 'dept', q.departmentType.toLowerCase());
  if (q.category) add('c.category_name LIKE :cat', 'cat', `%${q.category}%`);
  if (q.seller_name) add('c.seller_name = :seller', 'seller', q.seller_name);
  if (q.zonalHead) add('c.zonal_head = :zh', 'zh', q.zonalHead);
  if (q.status) {
    if (q.status === '__none__') conds.push("(c.order_status IS NULL OR c.order_status = '')");
    else add('c.order_status = :status', 'status', q.status);
  }
  if (q.buyingMode) add('c.buying_mode = :bm', 'bm', q.buyingMode);
  if (q.merilDb === 'YES') conds.push("c.meril_db IN ('YES', 'CONVERTED')");
  if (q.merilOthers) add('c.meril_or_others = :mo', 'mo', q.merilOthers);
  if (q.contractDateFrom) add(`${CONTRACT_DT} >= :df`, 'df', `${q.contractDateFrom} 00:00:00`);
  if (q.contractDateTo) add(`${CONTRACT_DT} <= :dt`, 'dt', `${q.contractDateTo} 23:59:59`);
  if (q.qtyValue) {
    const op = ['>=', '<=', '='].includes(q.qtyOperator) ? q.qtyOperator : '>=';
    add(`${QTY} ${op} :qty`, 'qty', Number(q.qtyValue));
  }
  if (q.valueFrom || q.valueTo) {
    const mult = q.valueUnit === 'Crore' ? 1e7 : 1e5;
    if (q.valueFrom && q.valueTo) {
      add(`${VALUE} BETWEEN :vmin AND :vmax`, 'vmin', parseFloat(q.valueFrom) * mult);
      r.vmax = parseFloat(q.valueTo) * mult;
    } else if (q.valueFrom) {
      const op = ['>=', '<=', '='].includes(q.valueOperator) ? q.valueOperator : '>=';
      add(`${VALUE} ${op} :vmin`, 'vmin', parseFloat(q.valueFrom) * mult);
    }
  }
  if (q.ids) {
    const ids = String(q.ids).split(',').map((n) => parseInt(n, 10)).filter(Boolean).slice(0, 5000);
    if (ids.length) add('c.id IN (:ids)', 'ids', ids);
  }
  return { where: conds.join(' AND '), replacements: r };
}

function orderBy(q) {
  const order = String(q.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const col = q.sortBy === 'total_value' ? VALUE : CONTRACT_DT;
  return `${col} ${order}, c.id ${order}`;
}

// Shape used by both the list API and the Excel export.
const toRow = (c) => ({
  id: c.id,
  contractNo: c.contract_no || '',
  bidNo: c.bid_no || '',
  buyingMode: c.buying_mode || '',
  status: c.order_status || '',
  contractDate: c.contract_date || '',
  zonalHead: c.zonal_head || '',
  hospitalName: c.hospital_name || c.organization_name || '',
  hospitalState: c.hospital_state || '',
  hospitalLocation: c.hospital_location || '',
  sellerName: c.seller_name || '',
  sellerState: c.seller_state || '',
  sellerLocation: c.seller_location || '',
  sellerContactNo: c.seller_contact_no || '',
  sellerEmail: c.seller_email || '',
  merilDb: c.meril_db === 'YES' || c.meril_db === 'CONVERTED' ? 'Yes' : 'No',
  merilOthers: c.meril_or_others ? String(c.meril_or_others).toUpperCase() : (/meril/i.test(c.brand || '') ? 'MERIL' : 'OTHERS'),
  category: c.category_name || '',
  product: c.product || '',
  brand: c.brand || '',
  model: c.model || '',
  decode: c.decode_code || c.product || '',
  companyName: c.company_name || c.brand || '',
  orderedQty: parseInt(c.ordered_quantity, 10) || 0,
  unitPrice: parseFloat(c.unit_price ?? c.price) || 0,
  contractValue: parseFloat(String(c.total_value ?? '').replace(/,/g, '')) || 0,
  buyerDepartment: c.buyer_department || '',
  buyerDeptOrg: c.buyer_dept_org || '',
  buyerDesignation: c.buyer_designation || '',
  officeZone: c.office_zone || '',
  pdfLink: c.pdf_link || '',
  dept: c.dept,
});
exports.toRow = toRow;
exports.helpers = { buildWhere, orderBy, LIST_COLUMNS, CONTRACT_DT, VALUE };

// @route GET /api/contracts
exports.getContracts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const { where, replacements } = buildWhere(req.query);

    const [rows, [summary]] = await Promise.all([
      sequelize.query(
        `SELECT ${LIST_COLUMNS} FROM contracts c WHERE ${where} ORDER BY ${orderBy(req.query)} LIMIT :limit OFFSET :offset`,
        { replacements: { ...replacements, limit, offset: (page - 1) * limit }, type: QueryTypes.SELECT },
      ),
      // Count + total value across every matching row (not just this page),
      // so the header summary always matches the filters.
      sequelize.query(`SELECT COUNT(*) AS total, SUM(${VALUE}) AS totalValue FROM contracts c WHERE ${where}`, { replacements, type: QueryTypes.SELECT }),
    ]);

    const total = Number(summary.total) || 0;
    res.json({ success: true, page, limit, total, totalValue: Number(summary.totalValue) || 0, totalPages: Math.ceil(total / limit), data: rows.map(toRow) });
  } catch (err) {
    console.error('getContracts error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch contracts' });
  }
};

// @route GET /api/contracts/meta/filters?departmentType=
// Category options follow the selected department (Endo only lists Endo
// categories and vice versa), same as the original.
exports.getFilters = async (req, res) => {
  try {
    const dept = req.query.departmentType && req.query.departmentType !== 'All' ? req.query.departmentType.toLowerCase() : null;
    const deptSql = dept ? 'AND c.dept = :dept' : "AND c.dept IN ('diagno','endo')";
    const rep = { dept };
    const [states, categories, zonalHeads, statuses] = await Promise.all([
      sequelize.query(`SELECT DISTINCT UPPER(c.hospital_state) AS v FROM contracts c WHERE c.hospital_state IS NOT NULL AND c.hospital_state <> '' ${deptSql} ORDER BY v`, { replacements: rep, type: QueryTypes.SELECT }),
      sequelize.query(`SELECT DISTINCT c.category_name AS v FROM contracts c WHERE c.category_name IS NOT NULL AND c.category_name <> '' ${deptSql} ORDER BY v`, { replacements: rep, type: QueryTypes.SELECT }),
      sequelize.query(`SELECT DISTINCT c.zonal_head AS v FROM contracts c WHERE c.zonal_head IS NOT NULL AND c.zonal_head <> '' ${deptSql} ORDER BY v`, { replacements: rep, type: QueryTypes.SELECT }),
      sequelize.query(`SELECT DISTINCT c.order_status AS v FROM contracts c WHERE c.order_status IS NOT NULL AND c.order_status <> '' ${deptSql} ORDER BY v`, { replacements: rep, type: QueryTypes.SELECT }),
    ]);
    res.json({ success: true, data: { states: states.map((r) => r.v), categories: categories.map((r) => r.v), zonalHeads: zonalHeads.map((r) => r.v), statuses: statuses.map((r) => r.v) } });
  } catch (err) {
    console.error('getFilters error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch filters' });
  }
};

// @route GET /api/contracts/export?…same filters…&ids=1,2,3
// Server-side Excel of every matching row (or just the selected ids) — the
// original built this in the browser from a 100,000-row fetch.
exports.exportContracts = async (req, res) => {
  try {
    const { where, replacements } = buildWhere(req.query);
    const rows = await sequelize.query(
      `SELECT ${LIST_COLUMNS} FROM contracts c WHERE ${where} ORDER BY ${orderBy(req.query)} LIMIT 100000`,
      { replacements, type: QueryTypes.SELECT },
    );

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('GeM Contracts');
    ws.columns = [
      { header: 'S No', key: 'sno', width: 7 },
      { header: 'Contract No', key: 'contractNo', width: 24 },
      { header: 'Bid/Direct', key: 'buyingMode', width: 11 },
      { header: 'Status', key: 'status', width: 28 },
      { header: 'Contract Date', key: 'contractDate', width: 18 },
      { header: 'Zonal Head', key: 'zonalHead', width: 22 },
      { header: 'Hospital Name', key: 'hospitalName', width: 38 },
      { header: 'Hospital State', key: 'hospitalState', width: 18 },
      { header: 'Seller Name', key: 'sellerName', width: 34 },
      { header: 'Meril DB', key: 'merilDb', width: 10 },
      { header: 'Seller State', key: 'sellerState', width: 18 },
      { header: 'Category', key: 'category', width: 28 },
      { header: 'Decode', key: 'decode', width: 30 },
      { header: 'MERIL/OTHERS', key: 'merilOthers', width: 14 },
      { header: 'Company Name', key: 'companyName', width: 30 },
      { header: 'Qty (Pcs)', key: 'orderedQty', width: 11 },
      { header: 'Unit Price', key: 'unitPrice', width: 14 },
      { header: 'Contract Value', key: 'contractValue', width: 16 },
      { header: 'PDF Link', key: 'pdfLink', width: 50 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    rows.map(toRow).forEach((r, i) => ws.addRow({ sno: i + 1, ...r }));
    ws.getColumn('unitPrice').numFmt = '#,##0.00';
    ws.getColumn('contractValue').numFmt = '#,##0.00';

    const tag = Object.keys(req.query).some((k) => !['sortBy', 'sortOrder'].includes(k) && req.query[k]) ? 'Filtered' : 'All';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="GeM-Contracts-${tag}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('exportContracts error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to export contracts' });
  }
};

// @route GET /api/contracts/:id
exports.getContractById = async (req, res) => {
  try {
    const [row] = await sequelize.query(`SELECT ${LIST_COLUMNS}, c.created_at FROM contracts c WHERE c.id = :id`, { replacements: { id: req.params.id }, type: QueryTypes.SELECT });
    if (!row) return res.status(404).json({ success: false, message: 'Contract not found' });
    res.json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('getContractById error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch contract' });
  }
};
