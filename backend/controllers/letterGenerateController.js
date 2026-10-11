'use strict';
// Workdesk > Letter Generate — a personal/organisation letter library. Letters
// are drafted by chat ("create a letter for Extension of Validity of Rate
// Contract", or any free-form request) using the company's own real letter
// formats (utils/letterTemplates.js, from asset/letter-templates/*.docx) as the
// house-style reference, then viewed, edited, downloaded (PDF / Word), shared
// by email and deleted. A tender link is OPTIONAL — when set, that tender's
// details are fed to the model; without it the letter is a general one.
// Ported from the old portal's "Letter Generate" bundle and redesigned.
// Rows are scoped to user_id (staff tokens carry the org owner's id, so the
// whole organisation shares one library).
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Op } = require('sequelize');
const { LetterFolder, LetterDocument, GemTender, OpenTenderDetail, StaffUser, AgreementTracking } = require('../models');
const { ollamaChat, parseJsonResponse } = require('../utils/ollamaClient');
const { matchTemplate, loadTemplates } = require('../utils/letterTemplates');
const { renderPdf } = require('../utils/letterPdf');
const { LETTERHEADS, normDivision, compose, composeFull } = require('../utils/letterheads');
const { resolveActor } = require('../utils/orgActor');
const { sendMail, isMailConfigured } = require('../utils/mailer');
const { helpers } = require('./tenderController');
const { fromUrlId } = helpers;

const UPLOAD_DIR = path.join(__dirname, '../uploads/letter-generate');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 25 * 1024 * 1024 } });
exports.uploadMiddleware = upload.single('file');

const toUrlId = (bid) => (bid || '').split('/').join('_');
const safeName = (s) => (s || 'letter').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'letter';
const textOf = (html) => String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const docSummary = (d) => ({
  id: d.id, folder: d.folder, title: d.title, fileName: d.fileName, source: d.source,
  bidNumber: d.bidNumber || null, division: d.division || null, urlId: d.bidNumber ? toUrlId(d.bidNumber) : null,
  templateUsed: d.templateUsed, createdByName: d.createdByName, createdAt: d.createdAt, updatedAt: d.updatedAt,
  sharedCount: Array.isArray(d.shares) ? d.shares.length : 0,
});
const actorName = async (req) => { try { return (await resolveActor(req))?.actorName || null; } catch (_) { return null; } };
const mine = (req, extra = {}) => ({ userId: req.user.id, ...extra });
const findDoc = (req) => LetterDocument.findOne({ where: mine(req, { id: req.params.id }) });
const bidFromBody = (v) => (v ? fromUrlId(String(v)) : null);

// Whatever real fields a tender has on record — GeM or Open — for the model to
// draw on. Missing fields are omitted; the prompt tells the model to leave a
// bracketed placeholder instead of inventing a value.
async function getTenderContext(bidNumber) {
  if (!bidNumber) return null;
  const underscored = bidNumber.replace(/\//g, '_');
  const gem = await GemTender.findOne({
    where: { bidNumber },
    attributes: ['bidNumber', 'items', 'department', 'dept', 'startDate', 'endDate', 'emdAmount', 'bidValue', 'state', 'district'],
    raw: true,
  });
  if (gem) return { source: 'gem', ...gem };
  const open = await OpenTenderDetail.findOne({
    where: { tenderId: [underscored, bidNumber] },
    attributes: ['tenderId', 'tenderTitle', 'organisationName', 'organisationChain', 'emdAmount', 'tenderValue', 'closingDate', 'openingDate', 'tenderRefno'],
    raw: true,
  });
  if (open) return { source: 'open', ...open };
  return { source: null, bidNumber };
}

// @route GET /api/letters/formats — the letter formats found in the .docx
exports.listFormats = async (req, res) => {
  try {
    const t = await loadTemplates();
    res.json({ success: true, data: t.map((x) => ({ id: x.id, subject: x.subject })) });
  } catch (err) {
    console.error('[letter-generate] listFormats:', err);
    res.status(500).json({ success: false, message: 'Failed to load letter formats' });
  }
};

// ---- folders ---------------------------------------------------------------

// @route GET /api/letters/folders
exports.listFolders = async (req, res) => {
  try {
    const rows = await LetterFolder.findAll({ where: mine(req), order: [['name', 'ASC']] });
    res.json({ success: true, data: rows.map((r) => ({ id: r.id, name: r.name })) });
  } catch (err) {
    console.error('[letter-generate] listFolders:', err);
    res.status(500).json({ success: false, message: 'Failed to load folders' });
  }
};

// @route POST /api/letters/folders  { name }
exports.createFolder = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 200);
    if (!name) return res.status(400).json({ success: false, message: 'Folder name is required' });
    await LetterFolder.findOrCreate({ where: mine(req, { name }) });
    res.json({ success: true });
  } catch (err) {
    console.error('[letter-generate] createFolder:', err);
    res.status(500).json({ success: false, message: 'Failed to create folder' });
  }
};

// @route PATCH /api/letters/folders/:id  { name } — letters inside follow the rename
exports.renameFolder = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 200);
    if (!name) return res.status(400).json({ success: false, message: 'Folder name is required' });
    const f = await LetterFolder.findOne({ where: mine(req, { id: req.params.id }) });
    if (!f) return res.status(404).json({ success: false, message: 'Folder not found' });
    if (await LetterFolder.findOne({ where: mine(req, { name, id: { [Op.ne]: f.id } }) })) {
      return res.status(409).json({ success: false, message: 'A folder with that name already exists' });
    }
    await LetterDocument.update({ folder: name }, { where: mine(req, { folder: f.name }) });
    f.name = name;
    await f.save();
    res.json({ success: true });
  } catch (err) {
    console.error('[letter-generate] renameFolder:', err);
    res.status(500).json({ success: false, message: 'Failed to rename folder' });
  }
};

// @route DELETE /api/letters/folders/:id — letters inside move back to "no folder"
exports.deleteFolder = async (req, res) => {
  try {
    const f = await LetterFolder.findOne({ where: mine(req, { id: req.params.id }) });
    if (!f) return res.status(404).json({ success: false, message: 'Folder not found' });
    await LetterDocument.update({ folder: '' }, { where: mine(req, { folder: f.name }) });
    await f.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('[letter-generate] deleteFolder:', err);
    res.status(500).json({ success: false, message: 'Failed to delete folder' });
  }
};

// ---- documents -------------------------------------------------------------

// @route GET /api/letters/documents?folder=&search=&link=all|general|tender|<urlId>&source=
// `folder` omitted = every folder; folder=none = letters not in any folder.
exports.listDocuments = async (req, res) => {
  try {
    const { folder, search = '', link = 'all', source, division, sort = 'updated' } = req.query;
    const where = mine(req);
    if (folder === 'none') where.folder = '';
    else if (folder) where.folder = String(folder);
    if (link === 'general') where.bidNumber = { [Op.or]: [null, ''] };
    else if (link === 'tender') where.bidNumber = { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] };
    else if (link && link !== 'all') where.bidNumber = fromUrlId(String(link));
    if (source === 'ai' || source === 'upload' || source === 'blank') where.source = source;
    if (division === 'endo' || division === 'diagno') where.division = division;
    else if (division === 'none') where.division = null;
    if (search) {
      const like = { [Op.like]: `%${search}%` };
      where[Op.or] = [{ title: like }, { bidNumber: like }, { htmlContent: like }];
    }
    const order = sort === 'created' ? [['createdAt', 'DESC']] : sort === 'oldest' ? [['createdAt', 'ASC']] : sort === 'title' ? [['title', 'ASC']] : [['updatedAt', 'DESC']];
    const rows = await LetterDocument.findAll({ where, order, attributes: { exclude: ['htmlContent'] } });

    const all = await LetterDocument.findAll({ where: mine(req), attributes: ['bidNumber', 'source'], raw: true });
    const counts = {
      all: all.length,
      tender: all.filter((d) => d.bidNumber).length,
      general: all.filter((d) => !d.bidNumber).length,
      uploaded: all.filter((d) => d.source === 'upload').length,
    };
    res.json({ success: true, data: rows.map(docSummary), counts });
  } catch (err) {
    console.error('[letter-generate] listDocuments:', err);
    res.status(500).json({ success: false, message: 'Failed to load letters' });
  }
};

// @route GET /api/letters/documents/:id
exports.getDocument = async (req, res) => {
  try {
    const doc = await findDoc(req);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { ...docSummary(doc), htmlContent: doc.htmlContent, shares: doc.shares || [] } });
  } catch (err) {
    console.error('[letter-generate] getDocument:', err);
    res.status(500).json({ success: false, message: 'Failed to load letter' });
  }
};

// @route GET /api/letters/documents/:id/preview — the letter with its division letterhead applied
// (trusted header/sign-off/footer HTML built from bundled assets; `bodyHtml` is user content and is sanitised by the client).
exports.previewDocument = async (req, res) => {
  try {
    const doc = await findDoc(req);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    if (doc.source === 'upload') return res.status(400).json({ success: false, message: 'Uploaded files have no preview' });
    const c = compose(doc.htmlContent, doc.division);
    res.json({ success: true, data: { division: c.division, headerHtml: c.header, bodyHtml: c.body, signoffHtml: c.signoff, leftoverHtml: c.leftover, footerHtml: c.footer } });
  } catch (err) {
    console.error('[letter-generate] previewDocument:', err);
    res.status(500).json({ success: false, message: 'Failed to build preview' });
  }
};

// @route POST /api/letters/documents  { title?, htmlContent?, folder?, bidNumber? } — a blank letter to write by hand
exports.createDocument = async (req, res) => {
  try {
    const { title, htmlContent, folder = '', bidNumber, division } = req.body || {};
    const doc = await LetterDocument.create({
      userId: req.user.id, title: String(title || 'Untitled letter').trim().slice(0, 500) || 'Untitled letter',
      htmlContent: htmlContent || '<p></p>', folder, bidNumber: bidFromBody(bidNumber), division: normDivision(division), source: 'blank', createdByName: await actorName(req),
    });
    res.status(201).json({ success: true, data: { ...docSummary(doc), htmlContent: doc.htmlContent } });
  } catch (err) {
    console.error('[letter-generate] createDocument:', err);
    res.status(500).json({ success: false, message: 'Failed to create letter' });
  }
};

// @route PATCH /api/letters/documents/:id  { title?, htmlContent?, folder?, bidNumber? }
exports.updateDocument = async (req, res) => {
  try {
    const doc = await findDoc(req);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    const { title, htmlContent, folder, bidNumber, division } = req.body || {};
    if (division !== undefined) doc.division = normDivision(division);
    if (typeof title === 'string' && title.trim()) doc.title = title.trim().slice(0, 500);
    if (typeof htmlContent === 'string' && doc.source !== 'upload') doc.htmlContent = htmlContent;
    if (typeof folder === 'string') doc.folder = folder;
    if (bidNumber !== undefined) doc.bidNumber = bidFromBody(bidNumber);
    await doc.save();
    res.json({ success: true, data: docSummary(doc) });
  } catch (err) {
    console.error('[letter-generate] updateDocument:', err);
    res.status(500).json({ success: false, message: 'Failed to update letter' });
  }
};

// @route DELETE /api/letters/documents/:id
exports.deleteDocument = async (req, res) => {
  try {
    const doc = await findDoc(req);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    const filePath = doc.filePath;
    await doc.destroy();
    if (filePath) fs.unlink(filePath, () => {});
    res.json({ success: true });
  } catch (err) {
    console.error('[letter-generate] deleteDocument:', err);
    res.status(500).json({ success: false, message: 'Failed to delete' });
  }
};

// @route POST /api/letters/upload  multipart: file, folder, bidNumber?
exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const doc = await LetterDocument.create({
      userId: req.user.id, folder: req.body?.folder || '', bidNumber: bidFromBody(req.body?.bidNumber),
      title: req.file.originalname, filePath: req.file.path, fileName: req.file.originalname, source: 'upload', createdByName: await actorName(req),
    });
    res.status(201).json({ success: true, data: docSummary(doc) });
  } catch (err) {
    console.error('[letter-generate] uploadFile:', err);
    res.status(500).json({ success: false, message: 'Failed to upload file' });
  }
};

// ---- download / share ------------------------------------------------------

async function buildDocx(html, division) {
  const HTMLtoDOCX = require('html-to-docx');
  const full = composeFull(html, division);
  let buf = await HTMLtoDOCX(full.body, full.header || null, {
    margins: { top: full.header ? 1900 : 1440, right: 1440, bottom: full.footer ? 1900 : 1440, left: 1440, gutter: 0, header: 500, footer: 300 },
    font: 'Calibri', fontSize: 22,
    table: { row: { cantSplit: true } }, header: !!full.header, footer: !!full.footer,
  }, full.footer || null);

  // html-to-docx always draws cell borders; tables marked borderless (the
  // "Ref No. …… date" line of the saved formats) get theirs switched off.
  const flags = [...full.body.matchAll(/<table\b[^>]*>/gi)].map((m) => /data-borderless="true"/.test(m[0]));
  if (flags.some(Boolean)) {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');
    let n = -1;
    const patched = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
      n += 1;
      return flags[n] ? tbl.replace(/w:val="single"/g, 'w:val="nil"').replace(/<w:top w:type="dxa" w:w="80"\/>/, '<w:top w:type="dxa" w:w="0"/>').replace(/<w:bottom w:type="dxa" w:w="80"\/>/, '<w:bottom w:type="dxa" w:w="0"/>').replace(/<w:left w:type="dxa" w:w="160"\/>/, '<w:left w:type="dxa" w:w="0"/>').replace(/<w:right w:type="dxa" w:w="160"\/>/, '<w:right w:type="dxa" w:w="0"/>') : tbl;
    });
    zip.file('word/document.xml', patched);
    buf = await zip.generateAsync({ type: 'nodebuffer' });
  }
  return buf;
}

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html; charset=utf-8',
};

// @route GET /api/letters/documents/:id/download?format=pdf|docx|html
exports.downloadDocument = async (req, res) => {
  try {
    const doc = await findDoc(req);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });

    if (doc.source === 'upload') {
      if (!doc.filePath || !fs.existsSync(doc.filePath)) return res.status(404).json({ success: false, message: 'File missing on disk' });
      return res.download(doc.filePath, doc.fileName || doc.title);
    }
    if (!doc.htmlContent) return res.status(404).json({ success: false, message: 'Nothing to download' });

    const format = ['pdf', 'html'].includes(req.query.format) ? req.query.format : 'docx';
    const body = format === 'pdf' ? await renderPdf(doc.htmlContent, doc.title, doc.division)
      : format === 'html' ? doc.htmlContent : await buildDocx(doc.htmlContent, doc.division);
    res.setHeader('Content-Type', MIME[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(doc.title)}.${format}"`);
    res.send(body);
  } catch (err) {
    console.error('[letter-generate] downloadDocument:', err);
    res.status(500).json({ success: false, message: 'Failed to build download' });
  }
};

// @route GET /api/letters/share-recipients — the organisation's active staff
exports.getShareRecipients = async (req, res) => {
  try {
    const actor = await resolveActor(req);
    if (!actor) return res.json({ success: true, data: [] });
    const staff = await StaffUser.findAll({ where: { partnerProfileId: actor.partnerProfileId, status: 'active' } });
    res.json({ success: true, data: staff.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role })) });
  } catch (err) {
    console.error('[letter-generate] getShareRecipients:', err);
    res.status(500).json({ success: false, message: 'Failed to load recipients' });
  }
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// @route POST /api/letters/documents/:id/share  { staffIds?, emails?, message?, attach?: ['pdf','docx'] }
// Emails the letter (as PDF and/or Word attachments, plus the text inline) to
// teammates and/or any typed addresses, and records it in the letter's history.
exports.shareDocument = async (req, res) => {
  try {
    const doc = await findDoc(req);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    const { staffIds = [], emails = [], message = '' } = req.body || {};
    const attach = (Array.isArray(req.body?.attach) && req.body.attach.length ? req.body.attach : ['pdf']).filter((f) => ['pdf', 'docx'].includes(f));

    const to = new Set((Array.isArray(emails) ? emails : []).map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)));
    if (Array.isArray(staffIds) && staffIds.length) {
      const actor = await resolveActor(req);
      if (actor) {
        const staff = await StaffUser.findAll({ where: { id: staffIds, partnerProfileId: actor.partnerProfileId, status: 'active' } });
        staff.forEach((s) => s.email && to.add(s.email.toLowerCase()));
      }
    }
    if (!to.size) return res.status(400).json({ success: false, message: 'Add at least one valid recipient' });
    if (!isMailConfigured()) {
      return res.status(422).json({ success: false, message: 'Email is not configured on this server — ask an admin to set EMAIL_HOST/EMAIL_USER/EMAIL_PASS.' });
    }

    const by = (await actorName(req)) || 'a teammate';
    const attachments = [];
    if (doc.source === 'upload') {
      if (doc.filePath && fs.existsSync(doc.filePath)) attachments.push({ filename: doc.fileName || doc.title, path: doc.filePath });
    } else {
      if (attach.includes('pdf')) attachments.push({ filename: `${safeName(doc.title)}.pdf`, content: await renderPdf(doc.htmlContent, doc.title, doc.division), contentType: MIME.pdf });
      if (attach.includes('docx')) attachments.push({ filename: `${safeName(doc.title)}.docx`, content: await buildDocx(doc.htmlContent, doc.division), contentType: MIME.docx });
    }
    const note = String(message || '').trim();
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;">
      <p><b>${escape(by)}</b> shared a letter with you: <b>${escape(doc.title)}</b>${doc.bidNumber ? ` (Tender ${escape(doc.bidNumber)})` : ''}.</p>
      ${note ? `<p style="padding:8px 12px;background:#f3f4f6;border-radius:6px;">${escape(note)}</p>` : ''}
      <p style="color:#6b7280;">The letter is attached.</p>
      ${doc.source !== 'upload' ? `<hr style="border:none;border-top:1px solid #e5e7eb;">${doc.htmlContent}` : ''}
    </div>`;

    await sendMail({ to: [...to].join(','), subject: `Letter: ${doc.title}`, html, attachments });

    doc.shares = [...(doc.shares || []), { at: new Date().toISOString(), by, to: [...to], via: 'email' }];
    await doc.save();

    // Sharing is the "sent" step of the Agreement Tracker: create/refresh its row so
    // the tracker updates by itself. Signed / rejected / expired agreements keep their
    // status (the email is only added to the history).
    try {
      const nowIso = new Date().toISOString();
      const recipients = [...to].join(', ');
      const [row, created] = await AgreementTracking.findOrCreate({
        where: { userId: req.user.id, letterId: doc.id },
        defaults: { userId: req.user.id, letterId: doc.id, status: 'sent', counterparty: recipients, sentOn: nowIso.slice(0, 10), updatedBy: by, history: [] },
      });
      const advance = created || row.status === 'sent' || row.status === 'under_review';
      const merged = [...new Set([...(row.counterparty ? row.counterparty.split(/\s*,\s*/) : []), ...to])].join(', ');
      Object.assign(row, {
        counterparty: advance ? merged.slice(0, 300) : row.counterparty,
        sentOn: row.sentOn || nowIso.slice(0, 10),
        updatedBy: by,
        history: [...(row.history || []), { at: nowIso, by, status: row.status, note: `Emailed to ${recipients}` }],
      });
      await row.save();
    } catch (e) { console.warn('[letter-generate] tracker update after share failed:', e.message); }
    res.json({ success: true, sentTo: [...to] });
  } catch (err) {
    console.error('[letter-generate] shareDocument:', err);
    const mailErr = err.code === 'EAUTH' || err.responseCode;
    res.status(mailErr ? 422 : 500).json({ success: false, message: mailErr ? 'Email could not be sent — Gmail rejected the login. Set EMAIL_USER to the Gmail address and EMAIL_PASS to its 16-character App Password in backend/.env, then restart the backend.' : 'Failed to share letter' });
  }
};

// Splits the model output into the letter HTML and the short note. Small local
// models often ignore the exact output contract (markdown headings instead of
// the |||REPLY||| separator, plain text instead of HTML), so this is lenient:
// it accepts a few separator spellings, drops markdown scaffolding, and turns
// plain text into paragraphs so the saved letter is always renderable HTML.
function splitDraft(raw) {
  let text = String(raw || '').trim();
  let reply = 'Letter drafted.';
  const sep = text.match(/\|\|\|\s*REPLY\s*\|\|\||^\s*#{1,4}\s*REPLY\b.*$/im);
  if (sep) {
    reply = text.slice(sep.index + sep[0].length).trim() || reply;
    text = text.slice(0, sep.index).trim();
  }
  text = text
    .replace(/\[\s*complete letter html here\s*\]/gi, '').replace(/\[\s*brief note\s*\]/gi, '')
    .replace(/```(?:html?)?/gi, '')
    .replace(/(?:&nbsp;| ){3,}/g, ' &nbsp; ')
    .replace(/<!doctype[^>]*>/gi, '').replace(/<head[\s\S]*?<\/head>/gi, '').replace(/<\/?(?:html|body)[^>]*>/gi, '')
    .replace(/^\s*#{1,4}\s*(complete\s+)?letter(\s+html)?\s*$/gim, '')
    .replace(/^\s*-{3,}\s*(?:(?:BEGIN|END)[A-Z ]*-{0,3})?\s*$/gm, '')
    .trim();
  if (!/<(p|table|div|br)\b/i.test(text)) {
    text = text.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean)
      .map((b) => `<p>${b.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\r?\n/g, '<br>')}</p>`).join('\n');
  }
  return { html: text, reply: reply.replace(/^-+\s*/, '').trim() };
}


// ---- saved-format filling ----------------------------------------------------
const decodeText = (t) => t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const encodeText = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ {2,}/g, (m) => ' ' + '&nbsp;'.repeat(m.length - 1));

// The letter as plain text with one line per visual line — what the model reads when it
// lists the facts to change (mammoth's raw text glues an address block into one line).
const htmlToLines = (h) => decodeText(String(h || '')
  .replace(/<\/td>\s*<td[^>]*>/gi, '    ')
  .replace(/<br\s*\/?>|<\/p>|<\/tr>|<\/li>/gi, '\n')
  .replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();

// Apply {from, to} edits to the text nodes of a letter's HTML (tags, styles and
// layout are never touched). Edits whose `from` is not really in the letter, or
// that would rewrite more than a short fact, are ignored.
function applyEdits(html, edits, sourceText) {
  const clean = (Array.isArray(edits) ? edits : [])
    .map((e) => ({ from: String(e && e.from != null ? e.from : '').trim(), to: String(e && e.to != null ? e.to : '').trim() }))
    .filter((e) => e.from && e.from !== e.to && e.from.length <= 200 && e.to.length <= 300 && String(sourceText).replace(/\s+/g, ' ').includes(e.from.replace(/\s+/g, ' ')));
  let applied = 0;
  const out = html.replace(/>([^<>]+)</g, (m, text) => {
    let t = decodeText(text);
    let changed = false;
    for (const e of clean) {
      if (t.includes(e.from)) { t = t.split(e.from).join(e.to); changed = true; }
    }
    return changed ? `>${encodeText(t)}<` : m;
  });
  for (const e of clean) if (!e.to || decodeText(out).includes(e.to)) applied += 1;
  // an edit that emptied a line leaves a stray <br>
  const tidy = clean.some((e) => !e.to) ? out.replace(/(<br>\s*){2,}/g, '<br>').replace(/<br>\s*<\/p>/g, '</p>') : out;
  return { html: tidy, applied };
}

const ORD = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));

// The letter's own date — the first "7th September,2026"-style date, which sits on the Ref line — becomes today's,
// keeping the format's own style (ordinal or not, comma spacing).
function refreshLetterDate(html, now) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let done = false;
  return html.replace(/>([^<>]+)</g, (m, text) => {
    if (done) return m;
    const re = /(\d{1,2})(st|nd|rd|th)?(\s|&nbsp;)+(January|February|March|April|May|June|July|August|September|October|November|December)(\s*,?\s*)(\d{4})/;
    if (!re.test(text)) return m;
    done = true;
    return '>' + text.replace(re, (all, d, ord, sp, mon, sep) => `${now.getDate()}${ord ? ORD(now.getDate()) : ''}${sp}${months[now.getMonth()]}${sep}${now.getFullYear()}`) + '<';
  });
}

// A saved letter format as HTML paragraphs (blank line = new paragraph,
// single line break kept as <br>) — the no-AI fallback draft.
function templateToHtml(body) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return String(body || '').replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
    .map((b) => `<p>${b.split('\n').map((l) => esc(l.trim())).join('<br>')}</p>`).join('\n');
}

// @route POST /api/letters/chat  { message, folder?, bidNumber?, documentId?, history? }
// Drafts a new letter — or, when documentId is given, revises that letter — from
// a chat request. The request decides subject and content; the closest of the
// company's real letter formats (by keyword overlap with each Subject line) is
// the house-style reference; a linked tender's own data fills in the facts.
exports.chatGenerate = async (req, res) => {
  const { message, folder = '', documentId } = req.body || {};
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!message || !message.trim()) return res.status(400).json({ success: false, message: 'message is required' });

  try {
    const existing = documentId ? await findDoc({ ...req, params: { id: documentId } }) : null;
    if (documentId && (!existing || existing.source === 'upload')) return res.status(404).json({ success: false, message: 'Letter not found' });

    const typedBid = (String(message).match(/GEM\/\d{4}\/[A-Z]\/\d+/i) || [])[0];
    const bidNumber = existing ? existing.bidNumber : (bidFromBody(req.body?.bidNumber) || (typedBid ? typedBid.toUpperCase() : null));
    const { template, matched } = await matchTemplate(message);
    const tender = await getTenderContext(bidNumber);

    // Which Meril division's letterhead this letter uses: an explicit choice wins;
    // otherwise the linked tender's own division (Diagno / Endo), then a division
    // named in the request, and — for the company's saved formats, which are Endo
    // letters — Endo. Free-form personal letters get no letterhead.
    const explicitDiv = req.body?.division;
    const division = existing ? existing.division
      : explicitDiv === 'none' ? null
        : (normDivision(explicitDiv) || normDivision(tender && tender.dept) || normDivision(message) || (matched ? 'endo' : null));
    const lhCfg = division ? LETTERHEADS[division] : null;
    const divisionRules = lhCfg
      ? `This letter is issued by ${lhCfg.company} (${lhCfg.label} division). The division's letterhead, signature, stamp, signatory and contact block are added automatically — so END the letter right after the line "Yours faithfully," and do NOT write any company name, signatory name, designation or contact lines after it.${division === 'diagno' ? ' Any reference-number prefix in a saved format belongs to the Endo division: write the reference number as [REF NO.] instead.' : ''} Never mention the other division.`
      : '';

    const recent = history.slice(-6);
    const historyText = recent.length
      ? '\n\nPrevious conversation context:\n' + recent.map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n')
      : '';
    const tenderLines = tender
      ? Object.entries(tender).filter(([k, v]) => k !== 'source' && v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n')
      : '';

    const referenceBlock = template
      ? `REFERENCE FORMAT — an actual letter this company has sent before, showing the house style (reference number style, salutation, tone, closing signature block, table structure) to follow:
---BEGIN REFERENCE LETTER---
${template.body}
---END REFERENCE LETTER---`
      : `NO SAVED FORMAT MATCHES THIS REQUEST. Write it as a free-form letter in standard, well-structured Indian letter style (date, "To," block, Subject line, salutation, body, closing) — do NOT reuse any tender/company letter format. If the request is personal (a leave letter, an application, a complaint), write it from the requester's own point of view; use [YOUR NAME], [DESIGNATION], [RECIPIENT NAME] and similar bracketed placeholders for details you do not know. Use tomorrow/today's real date only if the user gives a date; otherwise use [DATE].`;

    const tenderBlock = tender
      ? `THIS TENDER'S KNOWN DETAILS (use them to fill in bid number, dates, buyer, EMD, etc.):
---BEGIN TENDER DATA---
${tenderLines || '(no tender data on record)'}
---END TENDER DATA---`
      : 'No tender is linked to this letter — it is a general letter. Do not invent tender numbers; use bracketed placeholders like [TENDER NO.] where a detail is needed.';

    const task = existing
      ? `You are REVISING an existing letter. Apply the user's requested change and return the COMPLETE revised letter (not just the changed part). Keep everything else as is.
---BEGIN CURRENT LETTER---
${existing.htmlContent || ''}
---END CURRENT LETTER---`
      : "Write a NEW letter for the user's request.";

    const systemPrompt = `You are OpenProcure AI, an assistant that drafts letters for staff of an Indian company (Meril) — tender and business letters as well as ordinary personal/office letters.

${referenceBlock}
${tenderBlock}

${task}

Instructions:
1. Output the COMPLETE letter as HTML (well-formed <p>/<table> elements — no <html>/<head>/<body> wrapper tags).
${divisionRules ? `2a. ${divisionRules}\n` : ''}2. When a reference letter is given, use its house style (Ref No./Date line, "To," block, Subject, salutation, body, "Yours faithfully,", signature block — reuse its signature block verbatim). Otherwise use a standard free-form letter layout.
3. The user's request decides the subject and content. Fill real values from the tender data where available.
4. Where a value is not known (a bank UTR, an exact figure, an address), leave a clear bracketed placeholder such as [INSERT AMOUNT] — never invent one.
5. Keep a formal, professional tone.
6. After the HTML, write exactly this separator on its own line: |||REPLY|||
7. After the separator, write a brief 1-2 sentence note on what you drafted/changed.

Output format:
[Complete letter HTML here]
|||REPLY|||
[Brief note]`;
    const userPrompt = `${historyText}\n\nRequest: ${message}`;

    // The model occasionally returns an empty/near-empty response with no
    // error to catch — one retry before giving up rather than saving a blank
    // letter.
    // Small local models often answer the long, strict-format prompt with nothing
    // (or with the format placeholders). Attempt 1 uses the full prompt; attempt 2
    // a short, plain one; and for a NEW letter that matched a saved format, the
    // format itself is the last-resort draft — so the user never gets an error
    // for a request their own letter formats already cover.
    const shortSystem = `You are drafting a letter for an Indian office user. ${template ? `Write in the style of this example letter:\n---\n${template.body}\n---\n` : 'Use a standard formal Indian letter layout (date, To, Subject, salutation, body, closing); use bracketed placeholders like [YOUR NAME] for unknown details.\n'}${existing ? `Revise this letter as requested and output the full revised letter:\n---\n${existing.htmlContent || ''}\n---\n` : ''}${tenderLines ? `Known details:\n${tenderLines}\n` : ''}Output ONLY the letter as HTML <p> elements.`;
    let html = '';
    let reply = '';
    let usedFallback = false;

    if (template && !existing) {
      // A saved format matched: the letter must BE that format — layout, fonts,
      // alignment (e.g. the date at the right margin), wording and signature block
      // untouched. The model is only asked WHICH facts to swap (reference numbers,
      // buyer, tender no., contract dates, amounts…) as {from, to} edits, which are
      // applied to the format's own HTML; the letter's own date is set to today.
      const today = new Date();
      const base = template.html || templateToHtml(template.body);
      const letterText = htmlToLines(base);
      const editSystem = `You are adapting one of a company's SAVED LETTER FORMATS for a new case. The saved letter is reused EXACTLY as it is — you must NOT rewrite it. Your only job is to list the case-specific facts in it that have to change.

---BEGIN SAVED LETTER---
${letterText}
---END SAVED LETTER---

${tender ? `THE NEW CASE — tender details on record:\n${tenderLines}\n` : 'No tender details are on record for this request.'}
Reply with JSON only: {"edits":[{"from":"...","to":"..."}]}
Rules:
1. "from" must be copied EXACTLY, character for character, from ONE line of the saved letter above — a short piece (a reference number, a date, a buyer/addressee name or address line, a tender/bid/contract number, an amount, an item name). Never a whole sentence, and never text that runs across a line break: if a fact spans several lines (for example the addressee block under "To,"), give one edit per line — put the new value on the first line and use "" (empty) as "to" for the old lines that are no longer needed.
2. "to" is what replaces it for the new case, using the tender details and the user's message. If a needed value is not known, use a bracketed placeholder such as [REF NO.] or [BUYER NAME] — never invent facts.
3. Only list things that belong to the OLD case. Do not change wording, tone, structure or the signature block. Do not include the letter's own date at the top (it is set automatically).
4. If nothing needs to change, return {"edits":[]}.`;

      let edits = [];
      let modelOk = false;
      try {
        const raw = await ollamaChat(editSystem, `Request: ${message}`, { json: true, temperature: 0.1, numPredict: 2000 });
        const parsed = parseJsonResponse(raw);
        const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.edits) ? parsed.edits : null;
        if (list) { edits = list; modelOk = true; }
      } catch (e) { console.warn('[letter-generate] edit list failed:', e.message); }

      let applied;
      ({ html, applied } = applyEdits(base, edits, letterText));
      html = refreshLetterDate(html, today);
      if (division === 'diagno') html = html.replace(/MEPL\/[0-9-]+\/[A-Z]-?\d+/g, '[REF NO.]');
      reply = modelOk
        ? `Used your saved "${template.subject}" format as it is and updated ${applied} case-specific detail${applied === 1 ? '' : 's'} (reference, buyer, dates…). Placeholders in [brackets] still need your input.`
        : `I used your saved "${template.subject}" format as it is (only the date was updated) — fill in the case-specific details (reference numbers, buyer${tender ? '' : ', tender no.'}) or ask me to revise it.`;
      usedFallback = !modelOk;
    } else {
    for (let attempt = 0; attempt < 2 && html.length < 40; attempt++) {
      const raw = attempt === 0
        ? await ollamaChat(systemPrompt, userPrompt, { json: false, temperature: 0.15, numPredict: 8000 })
        : await ollamaChat(shortSystem, `Request: ${message}`, { json: false, temperature: 0.2, numPredict: 4000 });
      ({ html, reply } = splitDraft(raw));
    }
    }
    if (html.length < 40 && !existing && template) {
      html = templateToHtml(template.body);
      reply = `The AI model did not return a draft, so I started from your saved "${template.subject}" format. Review it and edit the details (or ask me to revise it).`;
      usedFallback = true;
    }
    if (html.length < 40) return res.status(502).json({ success: false, message: 'The AI returned an empty draft — please try again, or use a stronger model (OLLAMA_MODEL).' });

    let doc;
    if (existing) {
      existing.htmlContent = html;
      await existing.save();
      doc = existing;
    } else {
      const subjectMatch = html.match(/Subject\s*:?\s*([^<\n]+)/i);
      // A matched format's Subject is a reliable title; for free-form requests
      // the user's own words describe the letter better than the model's echo.
      const subject = subjectMatch ? textOf(subjectMatch[1]) : '';
      const baseTitle = subject.length >= 4 && !/^\[/.test(subject) ? subject : (matched && template ? template.subject : message);
      const title = `${baseTitle.trim()}${matched && bidNumber && !baseTitle.includes(bidNumber) ? ` – ${bidNumber}` : ''}`.slice(0, 200) || 'Untitled letter';
      doc = await LetterDocument.create({
        userId: req.user.id, bidNumber, folder, title, htmlContent: html, source: 'ai', division,
        templateUsed: matched && template ? template.subject : null, createdByName: await actorName(req),
      });
    }

    res.json({
      success: true, reply: (!reply || /^letter drafted\.?$/i.test(reply)) ? `Drafted "${doc.title}".` : reply,
      matchedFormat: matched && template ? template.subject : null,
      revised: !!existing,
      usedFallback,
      document: { ...docSummary(doc), htmlContent: html },
    });
  } catch (err) {
    console.error('[letter-generate] chatGenerate:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
