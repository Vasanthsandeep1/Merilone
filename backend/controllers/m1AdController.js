const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Op } = require('sequelize');
const { M1Ad, M1Category } = require('../models');

// Service Management > Post Ads: B2G users post banner images that run as the
// ad carousel on the Meril One customer app (GET /api/m1/ads, see appAds).
// Banner size: 1200 x 1100 px — fills the app's Home header; up to 5 MB.

const AD_DIR = path.join(__dirname, '..', 'uploads', 'm1-ads');
const SEGMENTS = ['home', 'hospital', 'lab', 'office', 'industry'];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const fail = (res, code, message) => res.status(code).json({ success: false, message });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(AD_DIR, { recursive: true }); cb(null, AD_DIR); },
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
}).single('image');

const withUpload = (handler) => (req, res) => upload(req, res, (err) => {
  if (err) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 5 MB)' : 'Could not upload the image');
  return handler(req, res);
});
const removeFile = (p) => { try { if (p) fs.unlinkSync(path.join(AD_DIR, path.basename(p))); } catch { /* already gone */ } };

const toJson = (a, cats = []) => ({
  id: a.id, title: a.title, imagePath: a.imagePath,
  headline: a.headline, subline: a.subline, ctaText: a.ctaText,
  targetType: a.targetType, targetCategoryId: a.targetCategoryId,
  targetName: a.targetType === 'category' ? cats.find((c) => c.id === a.targetCategoryId)?.name || null : null,
  segments: a.segments || [], startDate: a.startDate, endDate: a.endDate,
  sortOrder: a.sortOrder, status: a.status,
  // Showing in the app right now?
  live: a.status === 'Active' && (!a.startDate || a.startDate <= today()) && (!a.endDate || a.endDate >= today()),
  createdAt: a.createdAt,
});

// Validates the form fields (multipart text fields); returns { error } or { values }.
async function values(b) {
  const title = String(b.title || '').trim().slice(0, 120);
  if (!title) return { error: 'Enter a title for the ad' };
  const targetType = b.targetType === 'category' ? 'category' : 'none';
  let targetCategoryId = null;
  if (targetType === 'category') {
    targetCategoryId = Number(b.targetCategoryId) || null;
    if (!targetCategoryId || !(await M1Category.findByPk(targetCategoryId))) return { error: 'Choose the service category to open' };
  }
  let segs = b.segments;
  if (typeof segs === 'string') { try { segs = JSON.parse(segs); } catch { segs = segs.split(','); } }
  const segments = (Array.isArray(segs) ? segs : []).filter((s) => SEGMENTS.includes(s));
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const startDate = date(b.startDate);
  const endDate = date(b.endDate);
  if (startDate && endDate && endDate < startDate) return { error: 'End date must be on or after the start date' };
  // Banner text (optional), drawn by the app at the bottom-left.
  const text = (v, max) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max) || null;
  return {
    values: {
      title, targetType, targetCategoryId, segments, startDate, endDate,
      headline: text(b.headline, 40), subline: text(b.subline, 70), ctaText: text(b.ctaText, 20),
      sortOrder: Number.isFinite(Number(b.sortOrder)) ? Math.trunc(Number(b.sortOrder)) : 0,
      status: b.status === 'Paused' ? 'Paused' : 'Active',
    },
  };
}

// @route GET /api/m1-ads — the ads this user posted.
exports.list = async (req, res) => {
  try {
    const [rows, cats] = await Promise.all([
      M1Ad.findAll({ where: { userId: req.user.id }, order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']] }),
      M1Category.findAll({ attributes: ['id', 'name'], order: [['sortOrder', 'ASC']], raw: true }),
    ]);
    const data = rows.map((a) => toJson(a, cats));
    res.json({ success: true, data, categories: cats, stats: { total: data.length, live: data.filter((a) => a.live).length } });
  } catch (err) {
    console.error('m1 ads list error:', err);
    fail(res, 500, 'Failed to load ads');
  }
};

// @route POST /api/m1-ads  (multipart: image + fields)
exports.create = withUpload(async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, 'Upload the banner image (JPG, PNG or WebP)');
    const { error, values: v } = await values(req.body || {});
    if (error) { removeFile(req.file.filename); return fail(res, 400, error); }
    const ad = await M1Ad.create({ ...v, userId: req.user.id, imagePath: `/uploads/m1-ads/${req.file.filename}` });
    res.json({ success: true, data: toJson(ad, await M1Category.findAll({ raw: true })) });
  } catch (err) {
    console.error('m1 ad create error:', err);
    if (req.file) removeFile(req.file.filename);
    fail(res, 500, 'Failed to post the ad');
  }
});

// @route PUT /api/m1-ads/:id  (multipart: fields, optional new image)
exports.update = withUpload(async (req, res) => {
  try {
    const ad = await M1Ad.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!ad) { if (req.file) removeFile(req.file.filename); return fail(res, 404, 'Ad not found'); }
    const { error, values: v } = await values(req.body || {});
    if (error) { if (req.file) removeFile(req.file.filename); return fail(res, 400, error); }
    const old = ad.imagePath;
    await ad.update({ ...v, ...(req.file ? { imagePath: `/uploads/m1-ads/${req.file.filename}` } : {}) });
    if (req.file) removeFile(old);
    res.json({ success: true, data: toJson(ad, await M1Category.findAll({ raw: true })) });
  } catch (err) {
    console.error('m1 ad update error:', err);
    fail(res, 500, 'Failed to save the ad');
  }
});

// @route DELETE /api/m1-ads/:id
exports.remove = async (req, res) => {
  try {
    const ad = await M1Ad.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!ad) return fail(res, 404, 'Ad not found');
    const img = ad.imagePath;
    await ad.destroy();
    removeFile(img);
    res.json({ success: true });
  } catch (err) {
    console.error('m1 ad delete error:', err);
    fail(res, 500, 'Failed to delete the ad');
  }
};

// @route GET /api/m1/ads — for the customer app's carousel: Active ads within
// their dates, for this customer's background, in display order.
exports.appAds = async (req, res) => {
  try {
    const d = today();
    const segment = req.m1User?.segment || null;
    const rows = await M1Ad.findAll({
      where: {
        status: 'Active',
        [Op.and]: [
          { [Op.or]: [{ startDate: null }, { startDate: { [Op.lte]: d } }] },
          { [Op.or]: [{ endDate: null }, { endDate: { [Op.gte]: d } }] },
        ],
      },
      order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']],
    });
    const cats = await M1Category.findAll({ attributes: ['id', 'name'], raw: true });
    const data = rows
      .filter((a) => !(a.segments || []).length || (segment && a.segments.includes(segment)))
      .map((a) => ({
        id: a.id, title: a.title, imagePath: a.imagePath,
        headline: a.headline, subline: a.subline, ctaText: a.ctaText,
        target: a.targetType === 'category' && a.targetCategoryId
          ? { type: 'category', categoryId: a.targetCategoryId, name: cats.find((c) => c.id === a.targetCategoryId)?.name || 'Service' }
          : null,
      }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('m1 app ads error:', err);
    fail(res, 500, 'Could not load ads');
  }
};
