const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

// Competitor Portfolio Tracking (/analytics/company-profile) and Compare
// Competitors (/analytics/compare-bidders) — both derive from the migrated
// `contracts` table (GeM-awarded contracts), keyed by seller_name.
//
// The actual columns on this table are: id, bid_no, total_value, state,
// contract_date, order_status, seller_name, dept — no brand/product/
// unit_price/ordered_quantity/buying_mode/contract_no (an earlier version
// of this controller assumed those existed, which made every query here
// fail outright — verified live against the real table before rewriting).
// total_value is scraped free text (occasionally comma-separated), hence
// the REPLACE/CAST below.
const NUM = (col) => `CAST(REPLACE(IFNULL(${col}, '0'), ',', '') AS DECIMAL(15,2))`;

// @route GET /api/analytics/sellers
exports.getSellers = async (req, res) => {
  try {
    const rows = await sequelize.query(
      "SELECT DISTINCT seller_name FROM contracts WHERE seller_name IS NOT NULL AND seller_name != '' ORDER BY seller_name ASC",
      { type: QueryTypes.SELECT },
    );
    res.json({ success: true, data: rows.map((r) => r.seller_name) });
  } catch (err) {
    console.error('getSellers error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch sellers' });
  }
};

// @route GET /api/analytics/company-profile?seller=<name>
// Competitor Portfolio Tracking — KPIs + state/dept breakdown + recent
// awards for one seller.
exports.getCompanyProfile = async (req, res) => {
  try {
    const { seller } = req.query;
    if (!seller) return res.status(400).json({ success: false, message: 'seller is required' });

    const [[kpis], stateRows, deptRows, recentRows] = await Promise.all([
      sequelize.query(
        `SELECT COUNT(*) AS totalContracts,
                SUM(${NUM('total_value')}) AS totalRevenue,
                AVG(${NUM('total_value')}) AS avgContractValue,
                COUNT(DISTINCT state) AS statesCovered,
                COUNT(DISTINCT dept) AS deptsCovered,
                SUM(IF(order_status = 'Order Completed', 1, 0)) AS completedCount
         FROM contracts WHERE seller_name = :seller`,
        { replacements: { seller }, type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT state, COUNT(*) AS contracts, SUM(${NUM('total_value')}) AS revenue
         FROM contracts WHERE seller_name = :seller AND state IS NOT NULL AND state != ''
         GROUP BY state ORDER BY revenue DESC LIMIT 100`,
        { replacements: { seller }, type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT dept, COUNT(*) AS contracts, SUM(${NUM('total_value')}) AS revenue
         FROM contracts WHERE seller_name = :seller AND dept IS NOT NULL AND dept != ''
         GROUP BY dept ORDER BY revenue DESC`,
        { replacements: { seller }, type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT bid_no, state, dept, total_value, order_status, contract_date
         FROM contracts WHERE seller_name = :seller
         ORDER BY contract_date DESC LIMIT 100`,
        { replacements: { seller }, type: QueryTypes.SELECT },
      ),
    ]);

    const totalContracts = Number(kpis.totalContracts) || 0;
    res.json({
      success: true,
      data: {
        kpis: {
          totalContracts,
          totalRevenue: Number(kpis.totalRevenue) || 0,
          avgContractValue: Number(kpis.avgContractValue) || 0,
          statesCovered: Number(kpis.statesCovered) || 0,
          deptsCovered: Number(kpis.deptsCovered) || 0,
          completedPct: totalContracts ? Math.round(((Number(kpis.completedCount) || 0) / totalContracts) * 1000) / 10 : 0,
        },
        stateWise: stateRows.map((r) => ({ state: r.state, contracts: Number(r.contracts), revenue: Number(r.revenue) || 0 })),
        deptWise: deptRows.map((r) => ({ dept: r.dept, contracts: Number(r.contracts), revenue: Number(r.revenue) || 0 })),
        recentContracts: recentRows.map((r) => ({
          bidNo: r.bid_no, state: r.state, dept: r.dept, totalValue: Number(r.total_value) || 0, orderStatus: r.order_status, contractDate: r.contract_date,
        })),
      },
    });
  } catch (err) {
    console.error('getCompanyProfile error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch company profile' });
  }
};

// @route GET /api/analytics/compare-bidders?seller1=<name>&seller2=<name>
// Compare Competitors — head-to-head KPIs, state-wise and dept-wise revenue
// split, plus each seller's most recent awards.
exports.compareBidders = async (req, res) => {
  try {
    const { seller1, seller2 } = req.query;
    if (!seller1 || !seller2) return res.status(400).json({ success: false, message: 'seller1 and seller2 are required' });
    if (seller1 === seller2) return res.status(400).json({ success: false, message: 'Choose two different sellers' });

    const [kpiRows, stateRows, deptRows, recentRows] = await Promise.all([
      sequelize.query(
        `SELECT seller_name, COUNT(*) AS totalContracts, SUM(${NUM('total_value')}) AS totalRevenue,
                AVG(${NUM('total_value')}) AS avgValue, SUM(IF(order_status = 'Order Completed', 1, 0)) AS completedCount
         FROM contracts WHERE seller_name IN (:seller1, :seller2) GROUP BY seller_name`,
        { replacements: { seller1, seller2 }, type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT state,
                SUM(IF(seller_name = :seller1, ${NUM('total_value')}, 0)) AS seller1Revenue,
                SUM(IF(seller_name = :seller2, ${NUM('total_value')}, 0)) AS seller2Revenue
         FROM contracts WHERE seller_name IN (:seller1, :seller2) AND state IS NOT NULL AND state != ''
         GROUP BY state ORDER BY (seller1Revenue + seller2Revenue) DESC LIMIT 15`,
        { replacements: { seller1, seller2 }, type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT dept,
                SUM(IF(seller_name = :seller1, ${NUM('total_value')}, 0)) AS seller1Revenue,
                SUM(IF(seller_name = :seller2, ${NUM('total_value')}, 0)) AS seller2Revenue
         FROM contracts WHERE seller_name IN (:seller1, :seller2) AND dept IS NOT NULL AND dept != ''
         GROUP BY dept`,
        { replacements: { seller1, seller2 }, type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT bid_no, seller_name, state, dept, total_value, contract_date
         FROM contracts WHERE seller_name IN (:seller1, :seller2) ORDER BY id DESC LIMIT 10`,
        { replacements: { seller1, seller2 }, type: QueryTypes.SELECT },
      ),
    ]);

    const kpiFor = (name) => {
      const row = kpiRows.find((r) => r.seller_name === name);
      const totalContracts = Number(row?.totalContracts) || 0;
      return {
        sellerName: name,
        totalContracts,
        totalRevenue: Number(row?.totalRevenue) || 0,
        avgValue: Number(row?.avgValue) || 0,
        completedPct: totalContracts ? Math.round(((Number(row?.completedCount) || 0) / totalContracts) * 1000) / 10 : 0,
      };
    };

    res.json({
      success: true,
      data: {
        seller1: kpiFor(seller1),
        seller2: kpiFor(seller2),
        stateComparison: stateRows.map((r) => ({
          state: r.state, seller1Revenue: Number(r.seller1Revenue) || 0, seller2Revenue: Number(r.seller2Revenue) || 0,
        })),
        deptComparison: deptRows.map((r) => ({
          dept: r.dept, seller1Revenue: Number(r.seller1Revenue) || 0, seller2Revenue: Number(r.seller2Revenue) || 0,
        })),
        recentContracts: recentRows.map((r) => ({
          bidNo: r.bid_no, sellerName: r.seller_name, state: r.state, dept: r.dept, totalValue: Number(r.total_value) || 0, contractDate: r.contract_date,
        })),
      },
    });
  } catch (err) {
    console.error('compareBidders error:', err);
    res.status(500).json({ success: false, message: 'Failed to compare sellers' });
  }
};
