const { Op } = require('sequelize');
const { TenderTrackerEntry } = require('../models');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');

// Tenders > Tender Tracker — one row per tracked tender, matching the
// partner's own master tracking sheet ("Tracker Gem 26-27.xlsx") column for
// column (see models/TenderTrackerEntry.js). Scoped per partner (userId).
// Historical rows are imported once via scripts/importTenderTracker.js;
// going forward, new rows and column updates come from the tender pipeline
// itself (wired up separately, per the flow to be defined on top of this).

const COLUMNS = [
  'srNo', 'vertical', 'ra', 'entryDate', 'merilRefNo', 'gtCode', 'typeOfAccount', 'flsp', 'zm', 'hoPerson',
  'organizationName', 'location', 'state', 'tenderId', 'tenderNo', 'preBidEndDate', 'representationSubmitted',
  'tenderDueDate', 'dbHoNp', 'distributorName', 'productCode', 'brandDescription', 'lob', 'category', 'tenderQty',
  'uom', 'unitRate', 'totalValue', 'emdAmount', 'openClose', 'finalRemarks', 'otherRemarks',
  'l1UnitRate', 'l1CompanyName', 'l1CompanyModel', 'l2UnitRate', 'l2CompanyName', 'l2CompanyModel',
  'l3UnitRate', 'l3CompanyName', 'l3CompanyModel', 'businessValue', 'lastUpdated',
];

const SEARCHABLE = ['tenderNo', 'tenderId', 'merilRefNo', 'gtCode', 'organizationName', 'state', 'location', 'distributorName', 'brandDescription'];

// @route GET /api/tender-tracker
exports.listTracker = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 40));
    const offset = (page - 1) * limit;
    const { search, vertical, openClose, remarks } = req.query;

    const where = { userId: req.user.id };
    const and = [];
    if (vertical) where.vertical = vertical;
    if (openClose) where.openClose = openClose;
    if (remarks === '__blank__') and.push({ [Op.or]: [{ finalRemarks: null }, { finalRemarks: '' }] });
    else if (remarks) where.finalRemarks = remarks;
    if (search) and.push({ [Op.or]: SEARCHABLE.map((f) => ({ [f]: { [Op.like]: `%${search}%` } })) });
    if (and.length) where[Op.and] = and;

    const { rows, count } = await TenderTrackerEntry.findAndCountAll({
      where, order: [['srNo', 'ASC'], ['id', 'ASC']], limit, offset,
    });

    res.json({
      success: true,
      data: rows.map((r) => r.toJSON()),
      total: count,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(count / limit)),
    });
  } catch (err) {
    console.error('listTracker error:', err);
    res.status(500).json({ success: false, message: 'Failed to load tender tracker' });
  }
};

// @route GET /api/tender-tracker/remark-options
exports.getRemarkOptions = async (req, res) => {
  try {
    const rows = await TenderTrackerEntry.findAll({
      where: { userId: req.user.id, finalRemarks: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
      attributes: ['finalRemarks'], group: ['finalRemarks'], order: [['finalRemarks', 'ASC']],
    });
    res.json({ success: true, data: rows.map((r) => r.finalRemarks).filter(Boolean) });
  } catch (err) {
    console.error('getRemarkOptions error:', err);
    res.status(500).json({ success: false, message: 'Failed to load remark options' });
  }
};

// @route GET /api/tender-tracker/verticals
exports.getVerticals = async (req, res) => {
  try {
    const rows = await TenderTrackerEntry.findAll({
      where: { userId: req.user.id, vertical: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
      attributes: ['vertical'], group: ['vertical'], order: [['vertical', 'ASC']],
    });
    res.json({ success: true, data: rows.map((r) => r.vertical).filter(Boolean) });
  } catch (err) {
    console.error('getVerticals error:', err);
    res.status(500).json({ success: false, message: 'Failed to load verticals' });
  }
};

// @route POST /api/tender-tracker   — a new tender row, entered by hand for now
exports.createEntry = async (req, res) => {
  try {
    const payload = { userId: req.user.id };
    for (const f of COLUMNS) if (req.body[f] !== undefined) payload[f] = req.body[f] || null;
    if (!payload.srNo) {
      const max = await TenderTrackerEntry.max('srNo', { where: { userId: req.user.id } });
      payload.srNo = (max || 0) + 1;
    }
    const row = await TenderTrackerEntry.create(payload);
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('createEntry error:', err);
    res.status(500).json({ success: false, message: 'Failed to create tracker row' });
  }
};

// @route PUT /api/tender-tracker/:id   { ...any COLUMNS field }
exports.updateEntry = async (req, res) => {
  try {
    const row = await TenderTrackerEntry.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Row not found' });
    for (const f of COLUMNS) if (req.body[f] !== undefined) row[f] = req.body[f] || null;
    row.lastUpdated = new Date().toISOString().slice(0, 10);
    await row.save();
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('updateEntry error:', err);
    res.status(500).json({ success: false, message: 'Failed to save' });
  }
};

// @route DELETE /api/tender-tracker/:id
exports.deleteEntry = async (req, res) => {
  try {
    const row = await TenderTrackerEntry.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Row not found' });
    await row.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deleteEntry error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete' });
  }
};

// @route GET /api/tender-tracker/export?mode=all|filtered&<same filters as the list>
exports.exportExcel = safeHandler('tender tracker', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.listTracker, req, { clear: ['search', 'vertical', 'openClose', 'remarks'] });
  await sendWorkbook(res, {
    title: 'Tender Tracker', rows, mode, applied,
    columns: [
      { header: 'Sr. No.', key: 'srNo', width: 8, type: 'number' },
      { header: 'Vertical', key: 'vertical', width: 14 },
      { header: 'RA (Yes/No)', key: 'ra', width: 10 },
      { header: 'Date', key: 'entryDate', width: 14 },
      { header: 'Meril Ref No.', key: 'merilRefNo', width: 18 },
      { header: 'GT Code', key: 'gtCode', width: 14 },
      { header: 'Type of Account', key: 'typeOfAccount', width: 16 },
      { header: 'FLSP', key: 'flsp', width: 16 },
      { header: 'ZM', key: 'zm', width: 16 },
      { header: 'HO Person', key: 'hoPerson', width: 16 },
      { header: 'Organization Name', key: 'organizationName', width: 30 },
      { header: 'Location', key: 'location', width: 16 },
      { header: 'State', key: 'state', width: 16 },
      { header: 'Tender ID', key: 'tenderId', width: 16 },
      { header: 'Tender No', key: 'tenderNo', width: 24 },
      { header: 'Pre Bid End Date', key: 'preBidEndDate', width: 16 },
      { header: 'Representation submitted (Yes/No)', key: 'representationSubmitted', width: 16 },
      { header: 'Tender Due Date', key: 'tenderDueDate', width: 16 },
      { header: 'DB/HO/NP', key: 'dbHoNp', width: 12 },
      { header: 'Distributor Name', key: 'distributorName', width: 20 },
      { header: 'Product Code', key: 'productCode', width: 16 },
      { header: 'Brand / Description', key: 'brandDescription', width: 26 },
      { header: 'LOB', key: 'lob', width: 12 },
      { header: 'Category (P1/P2)', key: 'category', width: 12 },
      { header: 'Tender QTY (Pcs)', key: 'tenderQty', width: 14 },
      { header: 'UOM', key: 'uom', width: 10 },
      { header: 'UNIT RATE (Pcs) (Excl. of GST)', key: 'unitRate', width: 16 },
      { header: 'Total Value (Qty*Rate)', key: 'totalValue', width: 16 },
      { header: 'EMD amount', key: 'emdAmount', width: 14 },
      { header: 'Open/Close', key: 'openClose', width: 10 },
      { header: 'Final Remarks', key: 'finalRemarks', width: 26 },
      { header: 'Other Remarks', key: 'otherRemarks', width: 26 },
      { header: 'L1 Unit Rate (Excl of GST)', key: 'l1UnitRate', width: 14 },
      { header: 'L1 Company Name', key: 'l1CompanyName', width: 18 },
      { header: 'L1 Company Model', key: 'l1CompanyModel', width: 18 },
      { header: 'L2 Unit Rate (Excl. of GST)', key: 'l2UnitRate', width: 14 },
      { header: 'L2 Company Name', key: 'l2CompanyName', width: 18 },
      { header: 'L2 Company Model', key: 'l2CompanyModel', width: 18 },
      { header: 'L3 Unit Rate (Excl. of GST)', key: 'l3UnitRate', width: 14 },
      { header: 'L3 Company Name', key: 'l3CompanyName', width: 18 },
      { header: 'L3 Company Model', key: 'l3CompanyModel', width: 18 },
      { header: 'Business Value (L1*Qty)', key: 'businessValue', width: 16 },
      { header: 'Last Updated', key: 'lastUpdated', width: 14 },
    ],
  });
});
