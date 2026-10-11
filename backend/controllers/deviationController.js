const ExcelJS = require('exceljs');
const { GemTender, TenderProcessingResult, StaffUser } = require('../models');
const { fromUrlId, parseGemJsonData, getTenderDocText, SUMMARY_MODEL, buildSuggestionRow } = require('./tenderController').helpers;
const { getProductByCode } = require('../utils/productMatcher');
const { ollamaChat } = require('../utils/ollamaClient');
const { SYSTEM_PROMPT, buildUserPrompt } = require('../prompts/representationLetterPrompt');
const { resolveActor } = require('../utils/orgActor');
const { sendMail, isMailConfigured } = require('../utils/mailer');

// Ported from the OLD automation site's DeviationPage.jsx +
// deviationRepresentation.controller.js ("Deviation Analysis" page reached
// from a tender's Suggested Products) — full item-by-item deviation tables
// plus an Ollama-generated Representation Letter. Deviation table DATA
// itself already lives on TenderProcessingResult (see tenderController.js's
// getSuggestedProducts/recalculateSuggestion, which this reuses rather than
// duplicating) — this file adds the page-level read/edit/export/import and
// the letter generation/cache, which didn't exist yet.

async function loadResult(bidNumber) {
  return TenderProcessingResult.findOne({ where: { bidNo: bidNumber } });
}

// @route GET /api/tenders/:bidNumber/deviations
exports.getDeviations = async (req, res) => {
  try {
    const bidNumber = fromUrlId(req.params.bidNumber);
    const result = await loadResult(bidNumber);
    const rawProducts = Array.isArray(result?.suggestedProducts) ? result.suggestedProducts : [];
    const deviationTables = result?.deviationTables || {};
    // buildSuggestionRow maps the raw snake_case DB row (product_code,
    // relevancy_score, ...) into the camelCase shape the frontend's
    // SuggestedProduct type expects (productCode, relevancyScore, ...) —
    // same mapping getSuggestedProducts already uses; skipping it here was
    // why the item header showed "N/A" / "Please Verify From Your End"
    // even when a real product/score existed.
    const suggestedProducts = rawProducts
      .filter((p) => !p.deleted)
      .map((row) => buildSuggestionRow(row, new Map(), deviationTables));

    res.json({
      success: true,
      data: {
        suggestedProducts,
        deviationTables,
        hasRepresentation: !!result?.representationGeneratedAt,
      },
    });
  } catch (err) {
    console.error('getDeviations error:', err);
    res.status(500).json({ success: false, message: 'Failed to load deviations' });
  }
};

// @route PUT /api/tenders/:bidNumber/deviations
// Overwrites the whole deviation_tables JSON column — no diffing, matches
// OLD's Edit -> Save behavior exactly.
exports.updateDeviations = async (req, res) => {
  try {
    const bidNumber = fromUrlId(req.params.bidNumber);
    const { deviationTables } = req.body;
    if (!deviationTables || typeof deviationTables !== 'object') {
      return res.status(400).json({ success: false, message: 'deviationTables is required' });
    }
    const [result] = await TenderProcessingResult.findOrCreate({
      where: { bidNo: bidNumber },
      defaults: { bidNo: bidNumber, deviationTables },
    });
    result.deviationTables = deviationTables;
    await result.save();
    res.json({ success: true, data: deviationTables });
  } catch (err) {
    console.error('updateDeviations error:', err);
    res.status(500).json({ success: false, message: 'Failed to save deviations' });
  }
};

const EXCEL_COLUMNS = [
  { header: 'Item', key: 'item', width: 10 },
  { header: 'Product Code', key: 'productCode', width: 16 },
  { header: 'Specification', key: 'specification', width: 24 },
  { header: 'Tender Requirement', key: 'tender_requirement', width: 30 },
  { header: 'Product Offered', key: 'product_offered', width: 30 },
  { header: 'Status', key: 'status', width: 16 },
  { header: 'Reason', key: 'reason', width: 30 },
  { header: 'Remarks', key: 'remarks', width: 24 },
];

// @route GET /api/tenders/:bidNumber/deviations/export
exports.exportDeviationsExcel = async (req, res) => {
  try {
    const bidNumber = fromUrlId(req.params.bidNumber);
    const result = await loadResult(bidNumber);
    const suggestedProducts = Array.isArray(result?.suggestedProducts) ? result.suggestedProducts : [];
    const deviationTables = result?.deviationTables || {};
    const codeByItem = Object.fromEntries(suggestedProducts.map((p) => [p.item, p.product_code]));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Deviations');
    sheet.columns = EXCEL_COLUMNS;
    for (const [item, rows] of Object.entries(deviationTables)) {
      for (const row of rows || []) {
        sheet.addRow({ item, productCode: codeByItem[item] || '', ...row });
      }
    }
    sheet.getRow(1).font = { bold: true };
    sheet.dataValidations.add(`F2:F1000`, { type: 'list', formulae: ['"Complied,Not Complied,Not Specified,Not Applicable"'] });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="deviations_${bidNumber.replace(/\//g, '_')}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('exportDeviationsExcel error:', err);
    res.status(500).json({ success: false, message: 'Failed to export deviations' });
  }
};

// @route POST /api/tenders/:bidNumber/deviations/import (multipart, field "file")
// Parses back into { item_key: [...] } and RETURNS it — does not write to
// DB. The frontend loads this into edit mode; the user must still click
// Save (PUT .../deviations), same as OLD.
exports.importDeviationsExcel = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ success: false, message: 'Empty workbook' });

    const header = sheet.getRow(1).values.map((v) => String(v || '').trim().toLowerCase());
    const colIndex = (label) => header.indexOf(label);
    const idx = {
      item: colIndex('item'),
      specification: colIndex('specification'),
      tender_requirement: colIndex('tender requirement'),
      product_offered: colIndex('product offered'),
      status: colIndex('status'),
      reason: colIndex('reason'),
      remarks: colIndex('remarks'),
    };

    const deviationTables = {};
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const item = String(row.values[idx.item] || '').trim();
      if (!item) return;
      if (!deviationTables[item]) deviationTables[item] = [];
      deviationTables[item].push({
        specification: row.values[idx.specification] || '',
        tender_requirement: row.values[idx.tender_requirement] || '',
        product_offered: row.values[idx.product_offered] || '',
        status: row.values[idx.status] || 'Not Specified',
        reason: row.values[idx.reason] || '',
        remarks: row.values[idx.remarks] || '',
      });
    });

    res.json({ success: true, data: deviationTables });
  } catch (err) {
    console.error('importDeviationsExcel error:', err);
    res.status(500).json({ success: false, message: 'Failed to import file — check the format matches the exported template.' });
  }
};

function resolveProductName(product) {
  return product?.product_name || product?.item_category || 'the offered product';
}

// @route POST /api/tenders/:bidNumber/deviations/generate-representation
// body: { items?: string[] } — which item_keys' Not-Complied rows to
// include; all items if omitted. Unlike OLD's "whole table" button (which
// silently only ever covered item_1), this always covers exactly what's
// asked for. Always fresh — never reads the cache; explicit Save is what
// persists a result (see saveRepresentationLetter).
exports.generateRepresentationLetter = async (req, res) => {
  try {
    const bidNumber = fromUrlId(req.params.bidNumber);
    const { items } = req.body || {};

    const result = await loadResult(bidNumber);
    if (!result) return res.status(404).json({ success: false, message: 'No suggestions found for this tender yet' });

    const suggestedProducts = Array.isArray(result.suggestedProducts) ? result.suggestedProducts : [];
    const deviationTables = result.deviationTables || {};
    const itemKeys = Array.isArray(items) && items.length ? items : Object.keys(deviationTables);

    const notCompliedRows = [];
    let sno = 1;
    for (const itemKey of itemKeys) {
      const rows = deviationTables[itemKey] || [];
      for (const row of rows) {
        if (row.status === 'Not Complied' || row.status === 'Deviation') {
          notCompliedRows.push({ ...row, sno: sno++, item_key: itemKey });
        }
      }
    }
    if (!notCompliedRows.length) {
      return res.status(422).json({ success: false, message: 'No Not-Complied deviation rows found for the selected item(s) — nothing to write a representation for.' });
    }

    const primaryProduct = suggestedProducts.find((p) => itemKeys.includes(p.item)) || suggestedProducts[0];
    if (!primaryProduct?.product_code) {
      return res.status(422).json({ success: false, message: 'No product is selected for this tender yet.' });
    }
    const productSpec = getProductByCode(primaryProduct.product_code) || { product_code: primaryProduct.product_code, product_name: primaryProduct.product_name };
    const resolvedProductName = resolveProductName({ ...productSpec, ...primaryProduct });

    const tender = await GemTender.findOne({ where: { bidNumber } });
    const tenderJson = tender ? tender.toJSON() : {};
    const parsed = tenderJson.jsonData ? parseGemJsonData(tenderJson.jsonData) : null;
    const bidDocText = await getTenderDocText(tenderJson, parsed);

    const raw = await ollamaChat(
      SYSTEM_PROMPT,
      buildUserPrompt({ resolvedProductName, productCode: primaryProduct.product_code, notCompliedRows, productSpec, bidDocText }),
      { json: false, temperature: 0.2, numPredict: 12000, model: SUMMARY_MODEL }
    );

    let parsedLetter = null;
    const cleaned = (raw || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    try { parsedLetter = JSON.parse(cleaned); } catch (_) { /* try regex fallback below */ }
    if (!Array.isArray(parsedLetter)) {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) { try { parsedLetter = JSON.parse(match[0]); } catch (_) { /* give up below */ } }
    }
    if (!Array.isArray(parsedLetter)) {
      return res.status(502).json({ success: false, message: 'The AI model returned an unreadable response — please try again.' });
    }

    // Never trust product_offered/status/sno/item_key from the model —
    // re-attach them from the original rows by position, same as OLD.
    const data = parsedLetter.map((row, i) => ({
      specification: row.specification || notCompliedRows[i]?.specification || '',
      tender_requirement: row.tender_requirement || notCompliedRows[i]?.tender_requirement || '',
      reason: row.reason || '',
      justification: row.justification || '',
      representation: row.representation || '',
      product_offered: notCompliedRows[i]?.product_offered ?? '',
      status: notCompliedRows[i]?.status ?? '',
      sno: notCompliedRows[i]?.sno ?? i + 1,
      item_key: notCompliedRows[i]?.item_key ?? null,
    }));

    res.json({
      success: true,
      data,
      metadata: {
        bidNumber,
        productCode: primaryProduct.product_code,
        productName: resolvedProductName,
        dept: tenderJson.dept || result.dept || null,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('generateRepresentationLetter error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to generate representation letter' });
  }
};

// @route POST /api/tenders/:bidNumber/deviations/save-representation
exports.saveRepresentationLetter = async (req, res) => {
  try {
    const bidNumber = fromUrlId(req.params.bidNumber);
    const { htmlContent, data } = req.body || {};
    const [result] = await TenderProcessingResult.findOrCreate({
      where: { bidNo: bidNumber },
      defaults: { bidNo: bidNumber },
    });
    result.representationLetter = htmlContent || '';
    result.representationData = Array.isArray(data) ? data : [];
    result.representationGeneratedAt = new Date();
    const actor = await resolveActor(req).catch(() => null);
    result.representationGeneratedBy = actor?.actorName || null;
    await result.save();
    res.json({ success: true, updatedAt: result.representationGeneratedAt });
  } catch (err) {
    console.error('saveRepresentationLetter error:', err);
    res.status(500).json({ success: false, message: 'Failed to save representation letter' });
  }
};

// @route GET /api/tenders/:bidNumber/deviations/representation
exports.getRepresentationLetter = async (req, res) => {
  try {
    const bidNumber = fromUrlId(req.params.bidNumber);
    const result = await loadResult(bidNumber);
    if (!result?.representationGeneratedAt) {
      return res.json({ success: false, notGenerated: true });
    }
    res.json({
      success: true,
      htmlContent: result.representationLetter || '',
      data: result.representationData || [],
      updatedAt: result.representationGeneratedAt,
    });
  } catch (err) {
    console.error('getRepresentationLetter error:', err);
    res.status(500).json({ success: false, message: 'Failed to load representation letter' });
  }
};

// Ported from OLD's "Share" (ShareDeviationModal) — emails the deviation
// table to teammates. OLD pulled recipients from a pre-bid-meeting contact
// list this app has no equivalent of; recipients here are the org's own
// approved staff instead (see StaffUser, built earlier this session).

// @route GET /api/tenders/:bidNumber/deviations/share-recipients
// Deliberately NOT gated by requireOwner (unlike orgStaffRoutes.js) —
// sharing isn't a staff-management action, any logged-in member of the org
// (owner or staff) should be able to pick from their own teammates.
exports.getShareRecipients = async (req, res) => {
  try {
    const actor = await resolveActor(req);
    if (!actor) return res.status(404).json({ success: false, message: 'Complete your organization profile first' });
    const staff = await StaffUser.findAll({ where: { partnerProfileId: actor.partnerProfileId, status: 'active' } });
    res.json({ success: true, data: staff.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role })) });
  } catch (err) {
    console.error('getShareRecipients error:', err);
    res.status(500).json({ success: false, message: 'Failed to load recipients' });
  }
};

// @route POST /api/tenders/:bidNumber/deviations/share
exports.shareDeviation = async (req, res) => {
  try {
    const actor = await resolveActor(req);
    if (!actor) return res.status(404).json({ success: false, message: 'Complete your organization profile first' });
    const { staffIds } = req.body || {};
    if (!Array.isArray(staffIds) || !staffIds.length) {
      return res.status(400).json({ success: false, message: 'Select at least one recipient' });
    }
    if (!isMailConfigured()) {
      return res.status(422).json({ success: false, message: 'Email is not configured on this server — ask an admin to set EMAIL_HOST/EMAIL_USER/EMAIL_PASS.' });
    }

    const recipients = await StaffUser.findAll({ where: { id: staffIds, partnerProfileId: actor.partnerProfileId, status: 'active' } });
    if (!recipients.length) return res.status(404).json({ success: false, message: 'No valid recipients found' });

    const bidNumber = fromUrlId(req.params.bidNumber);
    const result = await loadResult(bidNumber);
    const deviationTables = result?.deviationTables || {};

    const rowsHtml = Object.entries(deviationTables).flatMap(([, rows]) => rows || []).map((r) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;">${r.specification || ''}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;">${r.tender_requirement || ''}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;">${r.product_offered || ''}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;">${r.status || ''}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;">${r.reason || ''}</td>
      </tr>`).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;">
        <h2 style="margin-bottom:4px;">Deviation Analysis — ${bidNumber}</h2>
        <p style="color:#6b7280;margin-top:0;">Shared by ${actor.actorName || 'a teammate'}</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Specification</th>
              <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Tender Requirement</th>
              <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Product Offered</th>
              <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Status</th>
              <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Reason</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    await Promise.all(recipients.map((r) => sendMail({
      to: r.email,
      subject: `Deviation Analysis — ${bidNumber}`,
      html,
    })));

    res.json({ success: true, sentTo: recipients.map((r) => r.email) });
  } catch (err) {
    console.error('shareDeviation error:', err);
    // Surface SMTP auth/connection failures specifically (EAUTH etc.) —
    // isMailConfigured() only checks the env vars are *set*, not that the
    // credentials actually work, so this is the only place a bad Gmail
    // app-password shows up.
    const isMailError = err.code === 'EAUTH' || err.responseCode;
    res.status(500).json({
      success: false,
      message: isMailError
        ? `Email could not be sent — check the EMAIL_* credentials in backend/.env (${err.response || err.message}).`
        : 'Failed to share deviation',
    });
  }
};
