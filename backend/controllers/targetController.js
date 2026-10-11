const { Op } = require('sequelize');
const { FlspTarget, StaffUser, PartnerProfile, User } = require('../models');
const fs = require('fs');
const path = require('path');
const TEMPLATE = require('../config/targetTemplate');
const PEOPLE = require('../config/targetPeople');
const { generatePersonPdf } = require('../utils/incentiveLetters/pdfGenerator');
const { EMAIL_RE } = require('./quotationController').pdfHelpers;

// Target letters (PDF) are private (salary-linked), so they live outside the
// public /uploads folder: backend/data/target-letters/<ownerId>/<staffId>-<fy>.pdf
const LETTER_ROOT = path.join(__dirname, '..', 'data', 'target-letters');
const letterFile = (ownerId, staffId, fy) => {
  const dir = path.join(LETTER_ROOT, String(Number(ownerId)));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Number(staffId)}-${Number(fy)}.pdf`);
};
const letterName = (name, fy) => `${String(name || 'target').replace(/[^a-z0-9]+/gi, '_')}_Sales_Target_FY${String(fy).slice(2)}-${String(fy + 1).slice(2)}.pdf`;
const fyLabel = (fy) => `${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;

// Builds the person's letter from their saved sheets, in the shape the
// letter generator expects ({ byName: { key: { displayName, rsm, zonalHead,
// groups: { g: { categories: { c: { months, total } } } }, total } } }).
async function makeLetter(ownerId, staff, fy) {
  const sheets = await FlspTarget.findAll({ where: { userId: ownerId, staffId: staff.id, fy } });
  if (!sheets.length) return null;
  const KEY = 'person';
  const shapeOf = (sh) => {
    if (!sh) return { byName: {} };
    const groups = {};
    for (const r of sh.rows || []) {
      groups[r.group] = groups[r.group] || { categories: {} };
      groups[r.group].categories[r.category] = { months: r.months, total: r.months.reduce((a, b) => a + b, 0) };
    }
    return { byName: { [KEY]: { displayName: staff.name, rsm: sh.rsm || '', zonalHead: sh.zonalHead || '', groups, total: Number(sh.total) || 0 } } };
  };
  const by = Object.fromEntries(sheets.map((x) => [x.division, x]));
  const pdf = await generatePersonPdf({
    personKey: KEY, mdpl: shapeOf(by.diagnostics), mepl: shapeOf(by.endo),
    fyLabel: fyLabel(fy), dateStr: `01st April ${fy}`,
  });
  fs.writeFileSync(letterFile(ownerId, staff.id, fy), Buffer.from(pdf));
  const at = new Date();
  await FlspTarget.update({ letterAt: at }, { where: { userId: ownerId, staffId: staff.id, fy } });
  return at;
}

// Target Management (Master Admin): create / edit a sales person's yearly
// target sheet per division, stored in flsp_targets.

const fail = (res, code, message) => res.status(code).json({ success: false, message });
const DIVISIONS = ['diagnostics', 'endo'];
const fyNow = () => { const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; };
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

const ownerOnly = (req, res) => {
  if (req.user.staffId) { fail(res, 403, 'Only the Master Admin can manage targets'); return false; }
  return true;
};
async function orgStaff(req) {
  const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
  if (!profile) return [];
  return StaffUser.findAll({
    where: { partnerProfileId: profile.id, role: ['flsp', 'sales', 'rsm'], status: { [Op.ne]: 'rejected' } },
    attributes: ['id', 'name', 'email', 'role', 'status'], order: [['name', 'ASC']],
  });
}

// Keeps only the template's rows, with 12 non-negative numbers each.
function cleanRows(division, rows) {
  const given = new Map((Array.isArray(rows) ? rows : []).map((r) => [`${r.group}|${r.category}`, r]));
  const out = [];
  for (const g of TEMPLATE[division].groups) {
    for (const c of g.categories) {
      const r = given.get(`${g.name}|${c}`);
      const months = Array.from({ length: 12 }, (_, i) => Math.max(0, r4(r?.months?.[i])));
      out.push({ group: g.name, category: c, months });
    }
  }
  return out;
}

// @route GET /api/targets/meta  — template + the people a target can be set for
exports.meta = async (req, res) => {
  try {
    if (!ownerOnly(req, res)) return;
    const staff = await orgStaff(req);
    // RSM / Zonal Head choices: the budget workbook's names + Zonal Manager logins.
    const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
    const zms = profile ? await StaffUser.findAll({ where: { partnerProfileId: profile.id, role: 'zonal_manager', status: 'active' }, attributes: ['name'], raw: true }) : [];
    // RSM logins in the org are offered as RSMs too (with no fixed Zonal Head).
    const rsmLogins = profile ? await StaffUser.findAll({ where: { partnerProfileId: profile.id, role: 'rsm', status: 'active' }, attributes: ['name'], raw: true }) : [];
    const rsms = [...PEOPLE.rsms, ...rsmLogins.filter((r) => !PEOPLE.rsms.some((p) => p.name.toLowerCase() === r.name.trim().toLowerCase())).map((r) => ({ name: r.name.trim(), zonalHeads: [] }))];
    const zonalHeads = [...new Set([...PEOPLE.zonalHeads, ...zms.map((z) => z.name.trim())])].sort((a, b) => a.localeCompare(b));
    res.json({ success: true, fy: fyNow(), template: TEMPLATE, staff, rsms, zonalHeads });
  } catch (err) {
    console.error('targets meta error:', err);
    fail(res, 500, 'Could not load targets');
  }
};

// @route GET /api/targets?fy=2026  — every saved target sheet for the year
exports.list = async (req, res) => {
  try {
    if (!ownerOnly(req, res)) return;
    const fy = Number(req.query.fy) || fyNow();
    const rows = await FlspTarget.findAll({ where: { userId: req.user.id, fy }, attributes: { exclude: ['rows'] }, order: [['updatedAt', 'DESC']] });
    res.json({ success: true, fy, data: rows });
  } catch (err) {
    console.error('targets list error:', err);
    fail(res, 500, 'Could not load targets');
  }
};

// @route GET /api/targets/:staffId?fy=2026  — that person's sheets (null = not created)
exports.get = async (req, res) => {
  try {
    if (!ownerOnly(req, res)) return;
    const fy = Number(req.query.fy) || fyNow();
    const staff = (await orgStaff(req)).find((s) => s.id === Number(req.params.staffId));
    if (!staff) return fail(res, 404, 'Person not found');
    const sheets = await FlspTarget.findAll({ where: { userId: req.user.id, staffId: staff.id, fy } });
    const by = Object.fromEntries(sheets.map((s) => [s.division, s]));
    res.json({ success: true, fy, staff, diagnostics: by.diagnostics || null, endo: by.endo || null });
  } catch (err) {
    console.error('targets get error:', err);
    fail(res, 500, 'Could not load the target');
  }
};

// @route PUT /api/targets/:staffId  { fy, division, rsm, zonalHead, rows }  — create or update
exports.save = async (req, res) => {
  try {
    if (!ownerOnly(req, res)) return;
    const staff = (await orgStaff(req)).find((s) => s.id === Number(req.params.staffId));
    if (!staff) return fail(res, 404, 'Person not found');
    const fy = Number(req.body.fy);
    const division = req.body.division;
    if (!(fy >= 2000 && fy <= 2100)) return fail(res, 400, 'Choose a financial year');
    if (!DIVISIONS.includes(division)) return fail(res, 400, 'Choose Diagnostics or Endo Surgery');
    const rows = cleanRows(division, req.body.rows);
    const total = r4(rows.reduce((s, r) => s + r.months.reduce((a, b) => a + b, 0), 0));
    const owner = await User.findByPk(req.user.id, { attributes: ['name'] });
    const values = {
      rows, total,
      rsm: String(req.body.rsm || '').trim().slice(0, 120) || null,
      zonalHead: String(req.body.zonalHead || '').trim().slice(0, 120) || null,
      updatedByName: owner?.name || null,
    };
    const [sheet, created] = await FlspTarget.findOrCreate({ where: { staffId: staff.id, fy, division }, defaults: { userId: req.user.id, ...values } });
    if (!created) await sheet.update(values);
    // Re-make the Sales Target letter with the new figures.
    let letterAt = null; let letterError = null;
    try { letterAt = await makeLetter(req.user.id, staff, fy); } catch (e) { console.error('target letter error:', e.message); letterError = 'The target was saved, but the PDF letter could not be made.'; }
    res.json({ success: true, created, data: sheet, letter: letterAt ? { at: letterAt, fileName: letterName(staff.name, fy) } : null, letterError });
  } catch (err) {
    console.error('targets save error:', err);
    fail(res, 500, 'Could not save the target');
  }
};

async function staffWithLetter(req) {
  const fy = Number(req.query.fy || req.body?.fy);
  const staff = (await orgStaff(req)).find((x) => x.id === Number(req.params.staffId));
  if (!staff || !fy) return null;
  const file = letterFile(req.user.id, staff.id, fy);
  return { staff, fy, file, exists: fs.existsSync(file) };
}

// @route GET /api/targets/:staffId/letter?fy=2026[&download=1]  — the PDF
exports.letter = async (req, res) => {
  try {
    if (!ownerOnly(req, res)) return;
    const f = await staffWithLetter(req);
    if (!f) return fail(res, 404, 'Person not found');
    if (!f.exists) {
      // Not made yet (e.g. saved before letters existed): make it now.
      if (!(await makeLetter(req.user.id, f.staff, f.fy))) return fail(res, 404, 'Save a target first');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${letterName(f.staff.name, f.fy)}"`);
    fs.createReadStream(f.file).pipe(res);
  } catch (err) {
    console.error('target letter view error:', err);
    fail(res, 500, 'Could not open the letter');
  }
};

// @route POST /api/targets/:staffId/letter/email  { fy, to, cc, subject, message }
exports.emailLetter = async (req, res) => {
  try {
    if (!ownerOnly(req, res)) return;
    const f = await staffWithLetter(req);
    if (!f) return fail(res, 404, 'Person not found');
    if (!f.exists && !(await makeLetter(req.user.id, f.staff, f.fy))) return fail(res, 404, 'Save a target first');
    const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((e) => e.trim()).filter(Boolean);
    const to = list(req.body?.to); const cc = list(req.body?.cc);
    if (!to.length) return fail(res, 400, 'Enter an email address to send to.');
    const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e));
    if (bad) return fail(res, 400, `"${bad}" isn't a valid email address.`);
    const { sendMail, isMailConfigured } = require('../utils/mailer');
    if (!isMailConfigured()) return fail(res, 503, 'Email sending is not set up on this server yet. Add the EMAIL_HOST, EMAIL_USER and EMAIL_PASS settings to backend/.env.');
    const label = fyLabel(f.fy);
    await sendMail({
      to: to.join(', '), cc: cc.length ? cc.join(', ') : undefined,
      subject: String(req.body?.subject || '').trim() || `Sales Target F.Y. ${label} — ${f.staff.name}`,
      text: String(req.body?.message || '').trim() || `Dear ${f.staff.name},

Please find attached your Sales Target letter for F.Y. ${label}.

Regards,`,
      attachments: [{ filename: letterName(f.staff.name, f.fy), content: fs.readFileSync(f.file), contentType: 'application/pdf' }],
    });
    const sentAt = new Date(); const sentTo = [...to, ...cc].join(', ').slice(0, 500);
    await FlspTarget.update({ letterSentAt: sentAt, letterSentTo: sentTo }, { where: { userId: req.user.id, staffId: f.staff.id, fy: f.fy } });
    res.json({ success: true, sentAt, sentTo });
  } catch (err) {
    console.error('target letter email error:', err);
    fail(res, 500, 'Could not send the email');
  }
};
