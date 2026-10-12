const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { Opi, OpiFormat, StaffUser, PartnerProfile, FlspTarget, User, Client, Quotation } = require('../models');
const TEMPLATE = require('../config/opiTemplate');
const calc = require('../utils/opiCalc');
const { renderOpiPdf } = require('../utils/opiPdf');
const { renderOpiExcel, DIAG_ROWS } = require('../utils/opiExcel');
const { EMAIL_RE } = require('./quotationController').pdfHelpers;

// OPI Management (Sales / FLSP logins): Create OPI (Endo or Diagnostics,
// filled like Meril's OPI Excel templates) and View My OPI. Each OPI is saved
// against the sales person, with its order value, and printed to a PDF that
// can be viewed, downloaded or emailed. The org's Master Admin can see all.

const fail = (res, code, message) => res.status(code).json({ success: false, message });
const PDF_ROOT = path.join(__dirname, '..', 'data', 'opi');
const pdfFile = (opi) => {
  const dir = path.join(PDF_ROOT, String(Number(opi.userId)));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${opi.id}.pdf`);
};
const pdfName = (opi) => `OPI_${opi.opiNo}_${String(opi.customerName || '').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.pdf`.replace(/_+\.pdf$/, '.pdf');

// The sales person behind the request (staff login), or null for the Master Admin.
async function me(req) {
  if (!req.user.staffId) return null;
  return StaffUser.findByPk(req.user.staffId, { attributes: ['id', 'name', 'email', 'role', 'partnerProfileId'] });
}

// The Master Admin (viewing the Sales portal) creates an OPI for one of their
// own sales / FLSP people, picked by id.
async function orgSalesPeople(req) {
  const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
  if (!profile) return [];
  return StaffUser.findAll({ where: { partnerProfileId: profile.id, role: ['sales', 'flsp', 'rsm'], status: 'active' }, attributes: ['id', 'name', 'email', 'role', 'partnerProfileId'], order: [['name', 'ASC']] });
}
async function actingFor(req, staffId) {
  const own = await me(req);
  if (own) return own;
  if (!staffId) return null;
  return (await orgSalesPeople(req)).find((s) => s.id === Number(staffId)) || null;
}

// ---------------- Department formats (fields people add / remove) ----------------
const BUILTIN = { endo: 'Endo Surgery', diagnostics: 'Diagnostics' };
const FIELD_TYPES = ['text', 'number', 'date'];
const cleanFields = (list) => (Array.isArray(list) ? list : []).slice(0, 40).map((f) => ({
  key: String(f?.key || '').trim(), label: String(f?.label || '').trim().slice(0, 60), type: FIELD_TYPES.includes(f?.type) ? f.type : 'text',
})).filter((f) => /^x_[a-z0-9_]{1,40}$/.test(f.key) && f.label);
const cleanHidden = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter((k) => /^[A-Za-z0-9_]{1,40}$/.test(k)))].slice(0, 80);
const formatJson = (f, deptKey, name, custom) => ({
  deptKey, name, custom,
  hidden: f?.hidden || [], customHeader: f?.customHeader || [], customLine: f?.customLine || [],
  updatedAt: f?.updatedAt || null, updatedByName: f?.updatedByName || null,
});

async function departments(ownerId) {
  const rows = await OpiFormat.findAll({ where: { userId: ownerId }, order: [['createdAt', 'ASC']] });
  const by = Object.fromEntries(rows.map((r) => [r.deptKey, r]));
  return [
    ...Object.entries(BUILTIN).map(([k, n]) => formatJson(by[k], k, n, false)),
    ...rows.filter((r) => r.custom).map((r) => formatJson(r, r.deptKey, r.name, true)),
  ];
}

// @route GET /api/opi/formats  — the departments and their saved fields
exports.formats = async (req, res) => {
  try { res.json({ success: true, data: await departments(req.user.id) }); } catch (err) {
    console.error('opi formats error:', err);
    fail(res, 500, 'Could not load the OPI departments');
  }
};

// @route POST /api/opi/formats  { name }  — add a department
exports.addDepartment = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (name.length < 2) return fail(res, 400, 'Enter a department name');
    const all = await departments(req.user.id);
    if (all.some((d) => d.name.toLowerCase() === name.toLowerCase())) return fail(res, 400, 'That department already exists');
    let deptKey = `d_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'dept'}`;
    while (all.some((d) => d.deptKey === deptKey)) deptKey += '_1';
    const user = await User.findByPk(req.user.id, { attributes: ['name'] });
    const row = await OpiFormat.create({ userId: req.user.id, deptKey, name, custom: true, hidden: [], customHeader: [], customLine: [], updatedByName: user?.name || null });
    res.json({ success: true, data: formatJson(row, row.deptKey, row.name, true) });
  } catch (err) {
    console.error('opi addDepartment error:', err);
    fail(res, 500, 'Could not add the department');
  }
};

// @route DELETE /api/opi/formats/:deptKey  — remove a department the org added.
// OPIs already created in it are kept (they carry the department's name).
exports.removeDepartment = async (req, res) => {
  try {
    const row = await OpiFormat.findOne({ where: { userId: req.user.id, deptKey: req.params.deptKey, custom: true } });
    if (!row) return fail(res, 404, 'Department not found');
    const kept = await Opi.count({ where: { userId: req.user.id, division: row.deptKey } });
    await row.destroy();
    res.json({ success: true, keptOpis: kept });
  } catch (err) {
    console.error('opi removeDepartment error:', err);
    fail(res, 500, 'Could not remove the department');
  }
};

// Saves a department's field layout (on Create OPI).
async function saveFormat(req, deptKey, format) {
  if (!format) return;
  const name = BUILTIN[deptKey];
  const [row] = await OpiFormat.findOrCreate({ where: { userId: req.user.id, deptKey }, defaults: { name: name || deptKey, custom: !name } });
  const who = req.user.staffId ? await StaffUser.findByPk(req.user.staffId, { attributes: ['name'] }) : await User.findByPk(req.user.id, { attributes: ['name'] });
  await row.update({ hidden: cleanHidden(format.hidden), customHeader: cleanFields(format.customHeader), customLine: cleanFields(format.customLine), updatedByName: who?.name || null });
  return row;
}

async function nextNo(division) {
  const prefix = division === 'endo' ? 'OPI-E-' : division === 'diagnostics' ? 'OPI-D-' : 'OPI-G-';
  const last = await Opi.findOne({ where: { opiNo: { [Op.like]: `${prefix}%` } }, order: [['id', 'DESC']], attributes: ['opiNo'] });
  let n = (Number(String(last?.opiNo || '').slice(prefix.length)) || 0) + 1;
  while (await Opi.count({ where: { opiNo: `${prefix}${String(n).padStart(5, '0')}` } })) n += 1;
  return `${prefix}${String(n).padStart(5, '0')}`;
}

async function makePdf(opi) {
  const staff = await StaffUser.findByPk(opi.staffId, { attributes: ['name', 'email'] });
  const pdf = await renderOpiPdf(opi, staff || { name: '', email: '' });
  fs.writeFileSync(pdfFile(opi), Buffer.from(pdf));
  opi.pdfAt = new Date();
  await opi.save();
}

const shape = (o, withData = false) => ({
  id: o.id, opiNo: o.opiNo, division: o.division, deptName: o.deptName || BUILTIN[o.division] || o.division, staffId: o.staffId, customerName: o.customerName, poNo: o.poNo, poDate: o.poDate,
  lines: (o.items || []).length, value: Number(o.value), totalValue: Number(o.totalValue),
  pdfAt: o.pdfAt, sentAt: o.sentAt, sentTo: o.sentTo, createdAt: o.createdAt,
  ...(withData ? { header: o.header, items: o.items } : {}),
});

// @route GET /api/opi/meta  — templates + what to prefill for this sales person
exports.meta = async (req, res) => {
  try {
    const staff = await actingFor(req, req.query.staffId);
    const people = req.user.staffId ? null : (await orgSalesPeople(req)).map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role }));
    // RSM / Zonal Head from their latest target sheet (Target Management), if any.
    const sheet = staff ? await FlspTarget.findOne({ where: { staffId: staff.id }, order: [['fy', 'DESC'], ['updatedAt', 'DESC']] }) : null;
    res.json({
      success: true,
      diagnostics: TEMPLATE.diagnostics,
      endo: TEMPLATE.endo,
      prefill: { name: staff?.name || '', email: staff?.email || '', rsm: sheet?.rsm || '', zonalHead: sheet?.zonalHead || '' },
      canCreate: !!staff || !!people?.length,
      people, // Master Admin: who the OPI can be created for
    });
  } catch (err) {
    console.error('opi meta error:', err);
    fail(res, 500, 'Could not load the OPI form');
  }
};

// @route POST /api/opi  { division, header, items, charges }  — sales login only
exports.create = async (req, res) => {
  try {
    const staff = await actingFor(req, req.body?.staffId);
    if (!staff) return fail(res, req.user.staffId ? 403 : 400, req.user.staffId ? 'Only a sales login can create an OPI' : 'Choose the sales person this OPI is for');
    const division = String(req.body?.division || '');
    const dept = (await departments(req.user.id)).find((d) => d.deptKey === division);
    if (!dept) return fail(res, 400, 'Choose a department');
    const out = division === 'endo' ? calc.endo(req.body) : division === 'diagnostics' ? calc.diagnostics(req.body, TEMPLATE.diagnostics.products) : calc.generic(req.body);
    if (!out.items.length) return fail(res, 400, 'Add at least one line');
    if (division === 'diagnostics' && !out.header.billName) return fail(res, 400, 'Enter the distributor billing name');
    if (division === 'diagnostics' && out.items.length > DIAG_ROWS) return fail(res, 400, `A Diagnostics OPI can have up to ${DIAG_ROWS} products (the OPI form's size)`);
    // The field layout used for this OPI: saved as the department's format, and kept with the OPI (PDF / Excel).
    const fmt = req.body?.format ? { hidden: cleanHidden(req.body.format.hidden), customHeader: cleanFields(req.body.format.customHeader), customLine: cleanFields(req.body.format.customLine) } : { hidden: dept.hidden, customHeader: dept.customHeader, customLine: dept.customLine };
    out.header.format = fmt;
    const first = out.items[0];
    const poDate = division === 'endo' ? first.poDate : out.header.poDate;
    const opi = await Opi.create({
      opiNo: await nextNo(division), userId: req.user.id, staffId: staff.id, division, deptName: dept.name,
      customerName: (division === 'endo' ? first.hospitalName || first.dealerName : division === 'diagnostics' ? out.header.billName : out.header.customerName) || null,
      poNo: (division === 'endo' ? first.poNo : out.header.poNo) || null,
      poDate: /^\d{4}-\d{2}-\d{2}$/.test(poDate || '') ? poDate : null,
      header: out.header, items: out.items, value: out.value, totalValue: out.totalValue,
    });
    try { await saveFormat(req, division, fmt); } catch (e) { console.error('opi save format error:', e.message); }
    let pdfError = null;
    try { await makePdf(opi); } catch (e) { console.error('opi pdf error:', e.message); pdfError = 'The OPI was saved, but its PDF could not be made.'; }
    res.json({ success: true, data: shape(opi, true), pdfError });
  } catch (err) {
    console.error('opi create error:', err);
    fail(res, 500, 'Could not create the OPI');
  }
};

// @route GET /api/opi?division=  — mine (sales login) / everyone's (Master Admin)
exports.list = async (req, res) => {
  try {
    const staff = await me(req);
    const where = staff ? { staffId: staff.id } : { userId: req.user.id };
    if (req.query.division) where.division = String(req.query.division);
    const rows = await Opi.findAll({ where, order: [['id', 'DESC']], attributes: { exclude: ['header'] } });
    const total = rows.reduce((s, o) => s + Number(o.value), 0);
    res.json({ success: true, data: rows.map((o) => shape(o)), stats: { count: rows.length, value: Math.round(total * 100) / 100 } });
  } catch (err) {
    console.error('opi list error:', err);
    fail(res, 500, 'Could not load OPIs');
  }
};

async function findOpi(req) {
  const staff = await me(req);
  const where = { id: req.params.id, ...(staff ? { staffId: staff.id } : { userId: req.user.id }) };
  return Opi.findOne({ where });
}

// @route GET /api/opi/:id
exports.get = async (req, res) => {
  try {
    const o = await findOpi(req);
    if (!o) return fail(res, 404, 'OPI not found');
    res.json({ success: true, data: shape(o, true) });
  } catch (err) {
    console.error('opi get error:', err);
    fail(res, 500, 'Could not load the OPI');
  }
};

// @route GET /api/opi/:id/pdf[?download=1]
exports.pdf = async (req, res) => {
  try {
    const o = await findOpi(req);
    if (!o) return fail(res, 404, 'OPI not found');
    if (!fs.existsSync(pdfFile(o))) await makePdf(o);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${pdfName(o)}"`);
    fs.createReadStream(pdfFile(o)).pipe(res);
  } catch (err) {
    console.error('opi pdf view error:', err);
    fail(res, 500, 'Could not open the PDF');
  }
};

// @route GET /api/opi/:id/excel  — Meril's OPI Excel template, filled in
exports.excel = async (req, res) => {
  try {
    const o = await findOpi(req);
    if (!o) return fail(res, 404, 'OPI not found');
    const buf = await renderOpiExcel(o);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfName(o).replace(/\.pdf$/, '.xlsx')}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('opi excel error:', err);
    fail(res, 500, 'Could not make the Excel file');
  }
};

// @route DELETE /api/opi/:id  — a sales person deletes their own OPI (the Master Admin: any in the org).
// The OPI and its PDF are removed; it no longer counts in their sales.
exports.remove = async (req, res) => {
  try {
    const o = await findOpi(req);
    if (!o) return fail(res, 404, 'OPI not found');
    fs.rmSync(pdfFile(o), { force: true });
    await o.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('opi remove error:', err);
    fail(res, 500, 'Could not delete the OPI');
  }
};

// ---------------- Fill an OPI from Sales & Invoices ----------------
// Pick a client (Our Clients), then one of their Sales Orders / Invoices /
// Quotations; the form is filled with the client's details and the lines.
const SOURCE_TYPES = ['sales_order', 'invoice', 'quotation', 'proforma'];
const DOC_LABEL = { sales_order: 'Sales Order', invoice: 'Invoice', quotation: 'Quotation', proforma: 'Proforma Invoice' };

// @route GET /api/opi/source/clients  — the org's clients (this person's own first)
exports.sourceClients = async (req, res) => {
  try {
    const rows = await Client.findAll({ where: { userId: req.user.id, status: 'Active' }, attributes: ['id', 'businessName', 'city', 'salesStaffId'], order: [['businessName', 'ASC']], raw: true });
    const mine = req.user.staffId || null;
    res.json({ success: true, data: rows.map((c) => ({ id: c.id, name: c.businessName, city: c.city, mine: !!mine && c.salesStaffId === mine })).sort((a, b) => Number(b.mine) - Number(a.mine)) });
  } catch (err) {
    console.error('opi sourceClients error:', err);
    fail(res, 500, 'Could not load clients');
  }
};

// @route GET /api/opi/source/clients/:id/docs  — that client's sales orders, invoices, quotations
exports.sourceDocs = async (req, res) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!client) return fail(res, 404, 'Client not found');
    const docs = await Quotation.findAll({
      where: { userId: req.user.id, clientId: client.id, docType: SOURCE_TYPES, status: { [Op.ne]: 'Rejected' } },
      attributes: ['id', 'docType', 'quotationNo', 'quotationDate', 'poNumber', 'grandTotal', 'items'], order: [['quotationDate', 'DESC'], ['id', 'DESC']],
    });
    const order = (d) => SOURCE_TYPES.indexOf(d.docType);
    res.json({
      success: true,
      data: docs.sort((a, b) => order(a) - order(b)).map((d) => ({
        id: d.id, docType: d.docType, label: DOC_LABEL[d.docType], no: d.quotationNo, date: d.quotationDate, poNumber: d.poNumber,
        total: Number(d.grandTotal) || 0, lines: Array.isArray(d.items) ? d.items.length : 0,
      })),
    });
  } catch (err) {
    console.error('opi sourceDocs error:', err);
    fail(res, 500, 'Could not load documents');
  }
};

// @route GET /api/opi/source/docs/:id  — client details + lines, ready to fill the form
exports.sourceDoc = async (req, res) => {
  try {
    const d = await Quotation.findOne({ where: { id: req.params.id, userId: req.user.id, docType: SOURCE_TYPES } });
    if (!d) return fail(res, 404, 'Document not found');
    const c = d.clientId ? await Client.findOne({ where: { id: d.clientId, userId: req.user.id } }) : null;
    const ship = d.shippingTo && typeof d.shippingTo === 'object' ? d.shippingTo : null;
    res.json({
      success: true,
      data: {
        doc: { id: d.id, docType: d.docType, label: DOC_LABEL[d.docType], no: d.quotationNo, date: d.quotationDate, poNumber: d.poNumber || '', poDate: d.poDate || d.quotationDate || '' },
        client: c ? {
          name: c.businessName || '', code: c.uniqueKey || '', gstin: c.gstin || '', pan: c.pan || '', email: c.email || '', phone: c.phone || '',
          address: c.streetAddress || '', city: c.city || '', state: c.state || '', pin: c.postalCode || '',
        } : null,
        ship: ship ? { name: ship.name || ship.businessName || '', address: ship.address || ship.streetAddress || '', city: ship.city || '', state: ship.state || '', pin: ship.pincode || ship.postalCode || '' } : null,
        items: (Array.isArray(d.items) ? d.items : []).map((it) => ({ name: String(it.name || '').trim(), description: String(it.description || '').trim(), hsn: it.hsn || '', qty: Number(it.qty) || 0, rate: Number(it.rate) || 0, unit: it.unit || '' })),
      },
    });
  } catch (err) {
    console.error('opi sourceDoc error:', err);
    fail(res, 500, 'Could not load the document');
  }
};

// @route POST /api/opi/:id/email  { to, cc, subject, message }
exports.email = async (req, res) => {
  try {
    const o = await findOpi(req);
    if (!o) return fail(res, 404, 'OPI not found');
    const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((e) => e.trim()).filter(Boolean);
    const to = list(req.body?.to); const cc = list(req.body?.cc);
    if (!to.length) return fail(res, 400, 'Enter an email address to send to.');
    const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e));
    if (bad) return fail(res, 400, `"${bad}" isn't a valid email address.`);
    const { sendMail, isMailConfigured } = require('../utils/mailer');
    if (!isMailConfigured()) return fail(res, 503, 'Email sending is not set up on this server yet. Add the EMAIL_HOST, EMAIL_USER and EMAIL_PASS settings to backend/.env.');
    if (!fs.existsSync(pdfFile(o))) await makePdf(o);
    await sendMail({
      to: to.join(', '), cc: cc.length ? cc.join(', ') : undefined,
      subject: String(req.body?.subject || '').trim() || `OPI ${o.opiNo}${o.customerName ? ` — ${o.customerName}` : ''}`,
      text: String(req.body?.message || '').trim() || `Please find attached OPI ${o.opiNo}.\n\nRegards,`,
      attachments: [{ filename: pdfName(o), content: fs.readFileSync(pdfFile(o)), contentType: 'application/pdf' }],
    });
    o.sentAt = new Date(); o.sentTo = [...to, ...cc].join(', ').slice(0, 500);
    await o.save();
    res.json({ success: true, sentAt: o.sentAt, sentTo: o.sentTo });
  } catch (err) {
    console.error('opi email error:', err);
    fail(res, 500, 'Could not send the email');
  }
};
