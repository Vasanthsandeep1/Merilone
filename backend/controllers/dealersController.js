const { Op, QueryTypes } = require('sequelize');
const { sequelize, PartnerDistributor } = require('../models');

const NUM = (col) => `CAST(REPLACE(REPLACE(IFNULL(${col}, '0'), ',', ''), ' ', '') AS DECIMAL(15,2))`;

// ---- Real dealer data (matches the automation site's Distributors.jsx
// exactly — a report over `contracts` rows already flagged meril_db='YES'
// during scraping, grouped by seller_name; not this partner's own
// PartnerDistributor CRUD list below, which is a separate concept used only
// for generating authorization letters). ----

// @route GET /api/dealers/report
exports.getContractDealers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const { search, state, dept, category, contractDateFrom, contractDateTo, sort } = req.query;

    // The real `contracts` table only has id, bid_no, total_value, state,
    // contract_date, order_status, seller_name, dept — there is no
    // meril_db flag, seller_state/location/contact/email, or
    // category_name (the original automation site's richer schema). Every
    // row is already Diagno/Endo, so that's the scope; "state" is the
    // contract's state; location/contact/email come back null; and the
    // "category" filter maps onto dept, the only category-like column.
    const conditions = ["seller_name IS NOT NULL AND seller_name != ''", "LOWER(contracts.dept) IN ('diagno', 'endo')"];
    const replacements = {};

    if (search) { conditions.push('contracts.seller_name LIKE :search'); replacements.search = `%${search}%`; }
    if (state) { conditions.push('contracts.state = :state'); replacements.state = state; }
    if (dept) { conditions.push('LOWER(contracts.dept) = :dept'); replacements.dept = dept.toLowerCase(); }
    if (category) { conditions.push('LOWER(contracts.dept) = :category'); replacements.category = category.toLowerCase(); }
    if (contractDateFrom) { conditions.push(`STR_TO_DATE(contracts.contract_date, '%d/%m/%Y %H:%i') >= :contractDateFrom`); replacements.contractDateFrom = contractDateFrom; }
    if (contractDateTo) { conditions.push(`STR_TO_DATE(contracts.contract_date, '%d/%m/%Y %H:%i') <= :contractDateTo`); replacements.contractDateTo = contractDateTo; }

    const whereSql = conditions.join(' AND ');

    const sortMap = {
      'contracts-desc': 'contractCount DESC', 'contracts-asc': 'contractCount ASC',
      'value-desc': 'totalValue DESC', 'value-asc': 'totalValue ASC',
      'name-asc': 'contracts.seller_name ASC', 'name-desc': 'contracts.seller_name DESC',
    };
    const orderBySql = sortMap[sort] || sortMap['contracts-desc'];

    const [rows, [{ total }]] = await Promise.all([
      sequelize.query(
        `SELECT contracts.seller_name AS sellerName,
                MAX(contracts.state) AS sellerState,
                NULL AS sellerLocation,
                NULL AS sellerContactNo,
                NULL AS sellerEmail,
                MAX(contracts.dept) AS dept,
                COUNT(*) AS contractCount,
                SUM(${NUM('contracts.total_value')}) AS totalValue
         FROM contracts
         WHERE ${whereSql}
         GROUP BY contracts.seller_name
         ORDER BY ${orderBySql}
         LIMIT :limit OFFSET :offset`,
        { replacements: { ...replacements, limit, offset }, type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT COUNT(*) AS total FROM (SELECT 1 FROM contracts WHERE ${whereSql} GROUP BY contracts.seller_name) x`,
        { replacements, type: QueryTypes.SELECT },
      ),
    ]);

    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, contractCount: Number(r.contractCount), totalValue: Number(r.totalValue) || 0 })),
      total: Number(total),
      page, limit, totalPages: Math.ceil(Number(total) / limit),
    });
  } catch (err) {
    console.error('getContractDealers error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dealers' });
  }
};

// @route GET /api/dealers/report/suggestions?q=
exports.getDealerSuggestions = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ success: true, data: [] });
    const rows = await sequelize.query(
      `SELECT DISTINCT seller_name FROM contracts WHERE seller_name LIKE :q ORDER BY seller_name LIMIT 15`,
      { replacements: { q: `%${q}%` }, type: QueryTypes.SELECT },
    );
    res.json({ success: true, data: rows.map((r) => r.seller_name) });
  } catch (err) {
    console.error('getDealerSuggestions error:', err);
    res.status(500).json({ success: false, message: 'Search failed' });
  }
};

// @route GET /api/dealers/report/states
exports.getDealerStates = async (req, res) => {
  try {
    const rows = await sequelize.query(
      `SELECT DISTINCT state FROM contracts WHERE state IS NOT NULL AND state != '' ORDER BY state ASC`,
      { type: QueryTypes.SELECT },
    );
    res.json({ success: true, data: rows.map((r) => r.state) });
  } catch (err) {
    console.error('getDealerStates error:', err);
    res.status(500).json({ success: false, message: 'Failed to load states' });
  }
};

// @route GET /api/dealers/report/categories
exports.getDealerCategories = async (req, res) => {
  try {
    // No category column exists — dept (Diagno/Endo) is the only
    // category-like field, so that's what the filter offers.
    const rows = await sequelize.query(
      `SELECT DISTINCT dept FROM contracts WHERE dept IS NOT NULL AND dept != '' ORDER BY dept ASC`,
      { type: QueryTypes.SELECT },
    );
    res.json({ success: true, data: rows.map((r) => r.dept) });
  } catch (err) {
    console.error('getDealerCategories error:', err);
    res.status(500).json({ success: false, message: 'Failed to load categories' });
  }
};

// @route GET /api/dealers/report/contracts?seller_name=
exports.getDealerContracts = async (req, res) => {
  try {
    const { seller_name: sellerName } = req.query;
    if (!sellerName) return res.status(400).json({ success: false, message: 'seller_name is required' });
    const rows = await sequelize.query(
      `SELECT bid_no AS contract_no, contract_date, NULL AS hospital_name, state AS hospital_state, dept AS category_name,
              NULL AS product, NULL AS ordered_quantity, total_value, order_status
       FROM contracts WHERE seller_name = :sellerName
       ORDER BY id DESC LIMIT 100`,
      { replacements: { sellerName }, type: QueryTypes.SELECT },
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getDealerContracts error:', err);
    res.status(500).json({ success: false, message: 'Failed to load contracts' });
  }
};

// "Distributors" below is a genuine CRUD+import screen over the original's
// real (but UI-less) `distributors` table shape, scoped per partner. The
// cross-tenant "Request Authorization" workflow (reseller -> OEM,
// approve/reject) lives in dealerAuthRequestController.js instead — see
// DealerAuthRequest.js for why that replaced the earlier single-tenant
// "generate my own letter" version of this feature.

// ---- Distributors ----

exports.listDistributors = async (req, res) => {
  try {
    const { search, state, status, sort } = req.query;
    const where = { userId: req.user.id };
    if (search) where.companyName = { [Op.like]: `%${search}%` };
    if (state) where.state = state;
    if (status) where.status = status;

    const sortMap = {
      'name-asc': [['companyName', 'ASC']],
      'name-desc': [['companyName', 'DESC']],
      'newest': [['createdAt', 'DESC']],
      'oldest': [['createdAt', 'ASC']],
    };

    const rows = await PartnerDistributor.findAll({ where, order: sortMap[sort] || sortMap.newest });
    res.json({ success: true, data: rows.map((r) => r.toJSON()) });
  } catch (err) {
    console.error('listDistributors error:', err);
    res.status(500).json({ success: false, message: 'Failed to load distributors' });
  }
};

exports.getDistributorStates = async (req, res) => {
  try {
    const rows = await PartnerDistributor.findAll({
      where: { userId: req.user.id, state: { [Op.ne]: null } },
      attributes: ['state'], group: ['state'], order: [['state', 'ASC']],
    });
    res.json({ success: true, data: rows.map((r) => r.state).filter(Boolean) });
  } catch (err) {
    console.error('getDistributorStates error:', err);
    res.status(500).json({ success: false, message: 'Failed to load states' });
  }
};

exports.createDistributor = async (req, res) => {
  try {
    const { companyName, personName, contactNo, email, cityName, state, registrationDate, status } = req.body;
    if (!companyName?.trim()) return res.status(400).json({ success: false, message: 'Company name is required' });
    const row = await PartnerDistributor.create({
      userId: req.user.id, companyName: companyName.trim(), personName, contactNo, email, cityName, state,
      registrationDate: registrationDate || null, status: status || 'Active',
    });
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('createDistributor error:', err);
    res.status(500).json({ success: false, message: 'Failed to create distributor' });
  }
};

exports.updateDistributor = async (req, res) => {
  try {
    const row = await PartnerDistributor.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Distributor not found' });
    const fields = ['companyName', 'personName', 'contactNo', 'email', 'cityName', 'state', 'registrationDate', 'status'];
    for (const f of fields) if (req.body[f] !== undefined) row[f] = req.body[f] || null;
    await row.save();
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('updateDistributor error:', err);
    res.status(500).json({ success: false, message: 'Failed to update distributor' });
  }
};

exports.deleteDistributor = async (req, res) => {
  try {
    const deleted = await PartnerDistributor.destroy({ where: { id: req.params.id, userId: req.user.id } });
    if (!deleted) return res.status(404).json({ success: false, message: 'Distributor not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteDistributor error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete distributor' });
  }
};

// @route POST /api/dealers/distributors/import  { rows: [{companyName,...}] }
// Frontend parses the CSV/XLSX client-side (same pattern as the app's other
// Excel-export features, via the already-installed `xlsx` package) and
// posts plain row objects — mirrors the original's array-of-rows import
// endpoint without needing a second multipart/file-parsing code path.
exports.importDistributors = async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ success: false, message: 'No rows to import' });

    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      const companyName = (row.companyName || row['Company Name'] || '').toString().trim();
      if (!companyName) { skipped += 1; continue; }
      await PartnerDistributor.create({
        userId: req.user.id,
        companyName,
        personName: row.personName || row['Person Name'] || null,
        contactNo: row.contactNo || row['Contact No'] || null,
        email: row.email || row['Email'] || null,
        cityName: row.cityName || row['City'] || null,
        state: row.state || row['State'] || null,
        status: (row.status || row['Status'] || 'Active').toString(),
      });
      imported += 1;
    }
    res.json({ success: true, imported, skipped });
  } catch (err) {
    console.error('importDistributors error:', err);
    res.status(500).json({ success: false, message: 'Import failed' });
  }
};

