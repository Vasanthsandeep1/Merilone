const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const { IncentiveLetter } = require('../models');
const { parseWorkbook, normalizeNameKey } = require('../utils/incentiveLetters/excelParser');
const { generatePersonPdf } = require('../utils/incentiveLetters/pdfGenerator');
const { EMAIL_RE } = require('./quotationController').pdfHelpers;

// Workdesk > Incentive Letter Generation — upload the Zonal budget workbook,
// pick salespeople, and generate each one's signed Sales Target letter PDF
// (letter + Diagnostics / Endo Surgery target tables). Ported from the
// standalone targeting-system tool; see utils/incentiveLetters/.
//
// Everything is private per user, under backend/data/incentive-letters/<userId>/
// (NOT the public /uploads folder — these are salary-linked targets):
//   dataset.json   the parsed workbook (so it survives restarts)
//   <uuid>.pdf     generated letters, listed via IncentiveLetter rows

const ROOT = path.join(__dirname, '..', 'data', 'incentive-letters');
const userDir = (userId) => {
  const dir = path.join(ROOT, String(Number(userId)));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const datasetFile = (userId) => path.join(userDir(userId), 'dataset.json');

// Parsed workbooks are big; keep the latest per user in memory too.
const cache = new Map(); // userId -> dataset
function loadDataset(userId) {
  if (cache.has(userId)) return cache.get(userId);
  const f = datasetFile(userId);
  if (!fs.existsSync(f)) return null;
  const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
  cache.set(userId, d);
  return d;
}

const shape = (l) => ({
  id: l.id, personKey: l.personKey, displayName: l.displayName, hasDiagnostics: l.hasDiagnostics, hasEndoSurgery: l.hasEndoSurgery,
  fileName: l.fileName, workbookName: l.workbookName, sentAt: l.sentAt, sentTo: l.sentTo, createdAt: l.createdAt,
});

// @route POST /api/incentive-letters/upload   (multipart: file = .xlsx)
exports.upload = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Choose the budget workbook (.xlsx) to upload' });
  try {
    if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ success: false, message: 'Upload an Excel .xlsx file' });
    const parsed = await parseWorkbook(req.file.path);
    if (!parsed.names.length) return res.status(400).json({ success: false, message: 'No salespeople were found in this workbook' });
    const dataset = { ...parsed, workbookName: req.file.originalname, uploadedAt: new Date().toISOString() };
    fs.writeFileSync(datasetFile(req.user.id), JSON.stringify(dataset));
    cache.set(req.user.id, dataset);
    res.json({ success: true, data: { names: parsed.names, workbookName: dataset.workbookName, uploadedAt: dataset.uploadedAt } });
  } catch (err) {
    console.error('incentive upload error:', err);
    res.status(400).json({ success: false, message: `Couldn't read this workbook: ${err.message}` });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
};

// @route GET /api/incentive-letters/names — the names from the last uploaded workbook.
exports.names = async (req, res) => {
  try {
    const d = loadDataset(req.user.id);
    if (!d) return res.json({ success: true, data: null });
    res.json({ success: true, data: { names: d.names, workbookName: d.workbookName, uploadedAt: d.uploadedAt } });
  } catch (err) {
    console.error('incentive names error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the workbook' });
  }
};

// @route POST /api/incentive-letters/generate   { keys: [...] }
// Generates (or re-generates) a letter for each name. The page calls this in
// small batches so it can show progress.
exports.generate = async (req, res) => {
  try {
    const d = loadDataset(req.user.id);
    if (!d) return res.status(400).json({ success: false, message: 'Upload the budget workbook first' });
    const keys = Array.isArray(req.body?.keys) ? req.body.keys.slice(0, 25) : [];
    if (!keys.length) return res.status(400).json({ success: false, message: 'Select at least one name' });

    const generated = [];
    const errors = [];
    for (const rawKey of keys) {
      const key = normalizeNameKey(rawKey);
      const person = d.mdpl.byName[key] || d.mepl.byName[key];
      if (!person) { errors.push({ key: rawKey, error: 'Not found in the workbook' }); continue; }
      try {
        const pdf = await generatePersonPdf({ personKey: key, mdpl: d.mdpl, mepl: d.mepl });
        const storedName = `${crypto.randomUUID()}.pdf`;
        fs.writeFileSync(path.join(userDir(req.user.id), storedName), pdf);
        const letter = await IncentiveLetter.create({
          userId: req.user.id,
          personKey: key,
          displayName: person.displayName,
          hasDiagnostics: !!d.mdpl.byName[key],
          hasEndoSurgery: !!d.mepl.byName[key],
          fileName: `${person.displayName.replace(/[^a-z0-9]+/gi, '_')}_Sales_Target.pdf`,
          storedName,
          workbookName: d.workbookName,
        });
        generated.push(shape(letter));
      } catch (err) {
        console.error(`incentive letter failed for ${rawKey}:`, err.message);
        errors.push({ key: rawKey, error: err.message });
      }
    }
    res.json({ success: true, data: { generated, errors } });
  } catch (err) {
    console.error('incentive generate error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate letters' });
  }
};

// @route GET /api/incentive-letters — generated letters, newest first.
exports.list = async (req, res) => {
  try {
    const rows = await IncentiveLetter.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC'], ['id', 'DESC']] });
    res.json({ success: true, data: rows.map(shape) });
  } catch (err) {
    console.error('incentive list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load letters' });
  }
};

async function findLetter(req) {
  const letter = await IncentiveLetter.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!letter) return null;
  const file = path.join(userDir(req.user.id), path.basename(letter.storedName));
  return fs.existsSync(file) ? { letter, file } : null;
}

// @route GET /api/incentive-letters/:id/file?download=1
exports.file = async (req, res) => {
  try {
    const found = await findLetter(req);
    if (!found) return res.status(404).json({ success: false, message: 'Letter not found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${found.letter.fileName}"`);
    fs.createReadStream(found.file).pipe(res);
  } catch (err) {
    console.error('incentive file error:', err);
    res.status(500).json({ success: false, message: 'Failed to open letter' });
  }
};

// @route POST /api/incentive-letters/zip   { ids: [...] } — download several letters at once.
exports.zip = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const rows = await IncentiveLetter.findAll({ where: { id: ids, userId: req.user.id } });
    if (!rows.length) return res.status(400).json({ success: false, message: 'Select letters to download' });
    const zip = new JSZip();
    const used = new Set();
    for (const l of rows) {
      const file = path.join(userDir(req.user.id), path.basename(l.storedName));
      if (!fs.existsSync(file)) continue;
      let name = l.fileName;
      for (let n = 2; used.has(name); n++) name = l.fileName.replace(/\.pdf$/, `_${n}.pdf`);
      used.add(name);
      zip.file(name, fs.readFileSync(file));
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="Sales_Target_Letters.zip"');
    res.send(buf);
  } catch (err) {
    console.error('incentive zip error:', err);
    res.status(500).json({ success: false, message: 'Failed to build the ZIP' });
  }
};

// @route DELETE /api/incentive-letters/:id
exports.remove = async (req, res) => {
  try {
    const letter = await IncentiveLetter.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!letter) return res.status(404).json({ success: false, message: 'Letter not found' });
    fs.unlink(path.join(userDir(req.user.id), path.basename(letter.storedName)), () => {});
    await letter.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('incentive delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete letter' });
  }
};

// @route POST /api/incentive-letters/:id/email   { to, cc, subject, message }
exports.email = async (req, res) => {
  try {
    const found = await findLetter(req);
    if (!found) return res.status(404).json({ success: false, message: 'Letter not found' });
    const { letter, file } = found;
    const parseList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((e) => e.trim()).filter(Boolean);
    const to = parseList(req.body?.to);
    const cc = parseList(req.body?.cc);
    if (!to.length) return res.status(400).json({ success: false, message: 'Enter an email address to send to.' });
    const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e));
    if (bad) return res.status(400).json({ success: false, message: `"${bad}" isn't a valid email address.` });

    const { sendMail, isMailConfigured } = require('../utils/mailer');
    if (!isMailConfigured()) return res.status(503).json({ success: false, message: 'Email sending is not configured on this server. Add the EMAIL_* settings to backend/.env.' });

    await sendMail({
      to: to.join(', '),
      cc: cc.length ? cc.join(', ') : undefined,
      subject: (req.body?.subject || '').trim() || `Sales Target F.Y. 26-27 — ${letter.displayName}`,
      text: (req.body?.message || '').trim() || `Dear ${letter.displayName},\n\nPlease find attached your Sales Target letter for F.Y. 26-27.\n\nRegards,`,
      attachments: [{ filename: letter.fileName, content: fs.readFileSync(file), contentType: 'application/pdf' }],
    });
    letter.sentAt = new Date();
    letter.sentTo = [...to, ...cc].join(', ').slice(0, 500);
    await letter.save();
    res.json({ success: true, data: { sentAt: letter.sentAt, sentTo: letter.sentTo } });
  } catch (err) {
    console.error('incentive email error:', err);
    res.status(500).json({ success: false, message: 'Failed to send email' });
  }
};
