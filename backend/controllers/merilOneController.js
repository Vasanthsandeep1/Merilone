const crypto = require('crypto');
const { Op } = require('sequelize');
const { QueryTypes } = require('sequelize');
const oemHelp = require('../utils/oemEngineers');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Problem photos from the booking screen: images only, 8 MB each, random
// file names (not guessable) under /uploads/m1-problems.
const PROBLEM_DIR = path.join(__dirname, '..', 'uploads', 'm1-problems');
const imageUpload = (dir) => multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(dir, { recursive: true }); cb(null, dir); },
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' }[file.mimetype] || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
}).single('photo');
const photoUpload = imageUpload(PROBLEM_DIR);
// After-work photos the engineer takes when closing a job.
const WORK_DIR = path.join(__dirname, '..', 'uploads', 'm1-work');
const workPhotoUpload = imageUpload(WORK_DIR);
const WORK_PHOTO_PATH = /^\/uploads\/m1-work\/[\w.-]+$/;
// Product photos (My Products) are kept in memory and saved in the database
// as base64 data URIs, not as files.
const productPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)),
}).single('photo');
const PRODUCT_PHOTO_DATA = /^data:image\/(jpeg|png|webp|heic|heif);base64,[A-Za-z0-9+/]+=*$/;
const MAX_PRODUCT_PHOTO_CHARS = 11 * 1024 * 1024; // ~8 MB image as base64
const PHOTO_PATH = /^\/uploads\/m1-problems\/[\w.-]+$/;
const { Client, Quotation, PartnerProfile } = require('../models');
const { sequelize, M1User, M1Otp, M1Category, M1Service, M1Booking, M1Product, M1CustomCategory, M1Notification } = require('../models');
const { signM1Token } = require('../middleware/m1Auth');
const { SEGMENTS } = require('../utils/merilOneCatalog');

// Meril One — API for the Customer and Service Engineer apps (meril-one/).
//
// Flow: customer books a service -> status 'requested' -> every available
// engineer with that skill whose area covers the booking (pincode in their
// service pincodes, or same city) sees it -> the first to accept gets it
// ('accepted') -> 'on_the_way' -> engineer enters the customer's 4-digit
// start OTP -> 'in_progress' -> 'completed' with the final bill -> customer
// rates. The customer can cancel until work starts.

// Bookings are for a start hour (9 AM to 8 PM); how long the job takes isn't
// known up front. Older bookings may hold a range like '09:00-12:00' — only
// its start hour counts. An engineer can't have two jobs at the same hour.
const SLOTS = Array.from({ length: 12 }, (_, i) => `${String(9 + i).padStart(2, '0')}:00`);
const slotStart = (slot) => String(slot || '').slice(0, 5);
const LIVE = ['requested', 'accepted', 'on_the_way', 'in_progress'];

// The start hours this engineer is already booked for, per date, from `from`
// onwards: jobs they have, plus requests sent to them by name.
// oemIds: their service-engineer ids at OEMs, so requests held for them as an
// OEM engineer count too. engineerId may be null (OEM engineer not on the app).
async function busySlots(engineerId, from, exceptBookingId = null, oemIds = []) {
  const rows = await M1Booking.findAll({
    where: {
      status: LIVE,
      scheduledDate: { [Op.gte]: from },
      [Op.or]: [
        ...(engineerId ? [{ engineerId }, { requestedEngineerId: engineerId }] : []),
        ...(oemIds.length ? [{ oemEngineerId: oemIds }] : []),
      ],
      ...(exceptBookingId ? { id: { [Op.ne]: exceptBookingId } } : {}),
    },
    attributes: ['scheduledDate', 'slot', 'rescheduleRequest'],
  });
  const busy = {};
  const add = (date, slot) => { (busy[date] = busy[date] || []).push(slotStart(slot)); };
  for (const r of rows) {
    add(r.scheduledDate, r.slot);
    // The new time an engineer asked for is held until the customer answers.
    const rq = r.rescheduleRequest;
    if (rq && rq.status === 'pending' && rq.date >= from) add(rq.date, rq.slot);
  }
  return busy;
}

// Current hour in India (0-23), for "that time has already passed" checks.
const nowHourIST = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));
// "Wed 8 Oct, 12 PM" for timeline notes.
const whenLabel = (date, slot) => {
  const h = Number(slotStart(slot).slice(0, 2));
  const d = new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${d}, ${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
};
const OTP_TTL_MS = 5 * 60 * 1000;
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const cleanPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
const fail = (res, code, message) => res.status(code).json({ success: false, message });
const norm = (s) => String(s || '').trim().toLowerCase();

const userJson = (u) => {
  const j = u.toJSON();
  return {
    id: j.id, phone: j.phone, role: j.role, name: j.name, email: j.email, segment: j.segment, orgName: j.orgName,
    address: j.address, city: j.city, pincode: j.pincode,
    skills: j.skills || [], servicePincodes: j.servicePincodes || [], experienceYears: j.experienceYears,
    companyName: j.companyName, about: j.about, rates: j.rates || {},
    b2gEngineer: j.b2gEngineer || null,
    isAvailable: j.isAvailable, profileComplete: j.profileComplete,
    rating: j.ratingCount ? Math.round((j.ratingSum / j.ratingCount) * 10) / 10 : null, ratingCount: j.ratingCount,
  };
};

const ratingOf = (u) => (u.ratingCount ? Math.round((u.ratingSum / u.ratingCount) * 10) / 10 : null);

const bookingJson = (b, viewer, viewerId) => {
  const j = b.toJSON();
  const out = {
    id: j.id, bookingNo: j.bookingNo, status: j.status, segment: j.segment,
    service: !j.service ? {
      id: 0,
      name: j.category ? `${j.category.name} service request` : 'Service request',
      durationMins: 60,
    } : {
      id: j.service.id,
      // Several services in one visit read "AC repair + Gas refill".
      name: Array.isArray(j.services) && j.services.length > 1 ? j.services.map((s) => s.name).join(' + ') : j.service.name,
      durationMins: j.service.durationMins,
    },
    services: Array.isArray(j.services) && j.services.length ? j.services : j.service ? [{ id: j.service.id, name: j.service.name }] : [],
    serviceChosen: !!j.service, // false = the customer only described the problem
    category: j.category ? { id: j.category.id, name: j.category.name, icon: j.category.icon, color: j.category.color } : null,
    issue: j.issue, equipment: j.equipment, address: j.address, city: j.city, pincode: j.pincode,
    contactName: j.contactName, contactPhone: j.contactPhone,
    scheduledDate: j.scheduledDate, slot: j.slot,
    visitCharge: Number(j.visitCharge), finalAmount: j.finalAmount != null ? Number(j.finalAmount) : null,
    partsUsed: j.partsUsed || [], workNotes: j.workNotes, rating: j.rating, review: j.review, cancelReason: j.cancelReason,
    timeline: j.timeline || [], createdAt: j.createdAt,
    rescheduleRequest: j.rescheduleRequest || null,
    photos: Array.isArray(j.photos) ? j.photos : [],
    workPhotos: Array.isArray(j.workPhotos) ? j.workPhotos : [],
    productId: j.productId || null, // booked from My Products
    arrivedAt: j.arrivedAt || null,
  };
  if (viewer === 'customer') {
    out.startOtp = ['accepted', 'on_the_way'].includes(j.status) ? j.startOtp : null;
    out.engineer = j.engineer ? {
      name: j.engineer.name, phone: j.engineer.phone, experienceYears: j.engineer.experienceYears,
      rating: j.engineer.ratingCount ? Math.round((j.engineer.ratingSum / j.engineer.ratingCount) * 10) / 10 : null,
      ratingCount: j.engineer.ratingCount, companyName: j.engineer.companyName,
    } : null;
    // Waiting for the engineer the customer picked.
    out.requestedEngineer = j.status === 'requested' && j.requestedEngineer
      ? { id: j.requestedEngineer.id, name: j.requestedEngineer.name, companyName: j.requestedEngineer.companyName }
      : j.status === 'requested' && j.oemEngineer ? { id: 0, name: j.oemEngineer.name, companyName: 'Authorised OEM engineer' } : null;
  } else {
    out.direct = j.status === 'requested' && !!viewerId && j.requestedEngineerId === viewerId;
    // Engineers see the customer's contact only once the job is theirs.
    const mine = j.status !== 'requested';
    out.customer = j.customer ? {
      name: j.contactName || j.customer.name, orgName: j.customer.orgName,
      phone: mine ? (j.contactPhone || j.customer.phone) : null,
    } : null;
    if (!mine) out.address = `${j.city} ${j.pincode}`; // full address after accepting
  }
  return out;
};

const withRefs = (extra = []) => [
  { model: M1Service, as: 'service', attributes: ['id', 'name', 'durationMins'] },
  { model: M1Category, as: 'category', attributes: ['id', 'name', 'icon', 'color'] },
  ...extra,
];
// Bell notification for the booking's customer (never blocks the action).
async function notifyCustomer(b, kind, title, body) {
  try { await M1Notification.create({ userId: b.customerId, bookingId: b.id, kind, title, body: body || null }); }
  catch (err) { console.error('m1 notify error:', err.message); }
}
const serviceName = (b) => (Array.isArray(b.services) && b.services.length > 1 ? b.services.map((s) => s.name).join(' + ') : b.service?.name || 'your service');

const stamp = (b, status, note) => { b.timeline = [...(b.timeline || []), { status, at: new Date().toISOString(), ...(note ? { note } : {}) }]; };

// ---------------- Auth ----------------

// @route POST /api/m1/auth/send-otp  { phone, role }
exports.sendOtp = async (req, res) => {
  try {
    const phone = cleanPhone(req.body.phone);
    const role = req.body.role;
    if (!/^[6-9]\d{9}$/.test(phone)) return fail(res, 400, 'Enter a valid 10-digit mobile number');
    if (!['customer', 'engineer'].includes(role)) return fail(res, 400, 'Invalid app');
    // Partner app: only service engineers registered in B2G can log in.
    if (role === 'engineer' && !(await oemHelp.b2gEngineerByPhone(phone))) {
      return fail(res, 403, "This number isn't registered as a service engineer. Ask your company to add you in Meril B2G (Service Management).");
    }
    const recent = await M1Otp.findOne({ where: { phone, role, createdAt: { [Op.gt]: new Date(Date.now() - 30 * 1000) } } });
    if (recent) return fail(res, 429, 'Please wait 30 seconds before requesting another OTP');

    const code = String(crypto.randomInt(100000, 1000000));
    await M1Otp.destroy({ where: { phone, role } });
    await M1Otp.create({ phone, role, codeHash: hash(`${phone}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) });

    // No SMS provider is configured yet: the OTP is logged on the server and,
    // outside production, returned so the app can show it for testing.
    console.log(`[Meril One] OTP for ${role} ${phone}: ${code}`);
    const devMode = process.env.NODE_ENV !== 'production';
    res.json({ success: true, message: 'OTP sent', ...(devMode ? { devOtp: code } : {}) });
  } catch (err) {
    console.error('m1 sendOtp error:', err);
    fail(res, 500, 'Could not send OTP');
  }
};

// @route POST /api/m1/auth/verify-otp  { phone, role, otp }
exports.verifyOtp = async (req, res) => {
  try {
    const phone = cleanPhone(req.body.phone);
    const { role } = req.body;
    const otp = String(req.body.otp || '').trim();
    const rec = await M1Otp.findOne({ where: { phone, role } });
    if (!rec || rec.expiresAt < new Date()) return fail(res, 400, 'OTP expired. Please request a new one');
    if (rec.attempts >= 5) return fail(res, 429, 'Too many wrong attempts. Please request a new OTP');
    if (rec.codeHash !== hash(`${phone}:${otp}`)) {
      rec.attempts += 1; await rec.save();
      return fail(res, 400, 'Incorrect OTP');
    }
    let b2g = null;
    if (role === 'engineer') {
      b2g = await oemHelp.b2gEngineerByPhone(phone);
      if (!b2g) return fail(res, 403, "This number isn't registered as a service engineer. Ask your company to add you in Meril B2G (Service Management).");
    }
    await rec.destroy();
    const [user, created] = await M1User.findOrCreate({ where: { phone, role }, defaults: { phone, role } });
    if (b2g) { oemHelp.applyB2gEngineer(user, b2g); await user.save(); }
    res.json({ success: true, token: signM1Token(user), user: userJson(user), isNew: created || !user.profileComplete });
  } catch (err) {
    console.error('m1 verifyOtp error:', err);
    fail(res, 500, 'Could not verify OTP');
  }
};

// ---------------- Notifications (the bell) ----------------

// @route GET /api/m1/notifications — latest 50, newest first, + unread count.
exports.notifications = async (req, res) => {
  try {
    const rows = await M1Notification.findAll({ where: { userId: req.m1User.id }, order: [['createdAt', 'DESC']], limit: 50 });
    const unread = await M1Notification.count({ where: { userId: req.m1User.id, readAt: null } });
    res.json({ success: true, unread, data: rows.map((n) => ({ id: n.id, bookingId: n.bookingId, kind: n.kind, title: n.title, body: n.body, read: !!n.readAt, at: n.createdAt })) });
  } catch (err) {
    console.error('m1 notifications error:', err);
    fail(res, 500, 'Could not load notifications');
  }
};

// @route POST /api/m1/notifications/read  { id? } — one, or all when no id.
exports.readNotifications = async (req, res) => {
  try {
    const where = { userId: req.m1User.id, readAt: null, ...(req.body?.id ? { id: Number(req.body.id) } : {}) };
    await M1Notification.update({ readAt: new Date() }, { where });
    res.json({ success: true });
  } catch (err) {
    console.error('m1 readNotifications error:', err);
    fail(res, 500, 'Could not update notifications');
  }
};

// ---------------- Profile ----------------

exports.me = async (req, res) => {
  const u = req.m1User;
  if (u.role === 'engineer') {
    const b2g = await oemHelp.b2gEngineerByPhone(u.phone);
    if (b2g) { oemHelp.applyB2gEngineer(u, b2g); if (u.changed()) await u.save(); }
  }
  res.json({ success: true, user: userJson(u) });
};

// @route PUT /api/m1/me
exports.updateMe = async (req, res) => {
  try {
    const u = req.m1User;
    const b = req.body || {};
    // Engineers registered in B2G: company and coverage come from B2G; name,
    // email, experience and skills can be corrected here and are saved back
    // to B2G.
    const b2g = u.role === 'engineer' ? await oemHelp.b2gEngineerByPhone(u.phone) : null;
    const name = String(b.name || (b2g ? b2g.name : '')).trim();
    const city = String(b.city || (b2g ? u.city : '') || '').trim();
    const pincode = String(b.pincode || '').trim();
    if (!name) return fail(res, 400, 'Enter your name');
    if (!city) return fail(res, 400, 'Enter your city');
    if (!(b2g && !pincode) && !/^\d{6}$/.test(pincode)) return fail(res, 400, 'Enter a valid 6-digit pincode');
    const email = String(b.email ?? (b2g ? b2g.email || '' : '')).trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address');
    Object.assign(u, { name, city, pincode: pincode || null, email: email || null });

    if (u.role === 'customer') {
      if (!SEGMENTS.includes(b.segment)) return fail(res, 400, 'Choose your background');
      if (b.segment !== 'home' && !String(b.orgName || '').trim()) return fail(res, 400, 'Enter your hospital / company name');
      Object.assign(u, { segment: b.segment, orgName: String(b.orgName || '').trim() || null, address: String(b.address || '').trim() || null });
      // Linking to a B2G record: only one whose number really is this user's.
      if (b.b2gLink && ['client', 'user'].includes(b.b2gLink.source)) {
        const phone = String(u.phone).slice(-10);
        const id = Number(b.b2gLink.id);
        const sql = b.b2gLink.source === 'client'
          ? `SELECT c.id FROM clients c WHERE c.id = :id AND (${DIGITS10('c.phone')} = :phone OR EXISTS (
               SELECT 1 FROM client_contact_links l JOIN partner_contacts pc ON pc.id = l.partner_contact_id
                WHERE l.client_id = c.id AND (${DIGITS10('pc.mobile')} = :phone OR ${DIGITS10('pc.alt_mobile')} = :phone OR ${DIGITS10('pc.whatsapp')} = :phone)))`
          : `SELECT id FROM users WHERE id = :id AND ${DIGITS10('mobile')} = :phone`;
        const ok = await sequelize.query(sql, { replacements: { id, phone }, type: QueryTypes.SELECT });
        if (ok.length) u[b.b2gLink.source === 'client' ? 'b2gClientId' : 'b2gUserId'] = id;
      }
    } else {
      const ids = (await M1Category.findAll({ attributes: ['id'], raw: true })).map((c) => c.id);
      const skills = (Array.isArray(b.skills) ? b.skills : []).map(Number).filter((id) => ids.includes(id));
      if (!skills.length) return fail(res, 400, 'Choose at least one skill');
      const pins = (Array.isArray(b.servicePincodes) ? b.servicePincodes : String(b.servicePincodes || '').split(/[\s,]+/))
        .map((p) => String(p).trim()).filter((p) => /^\d{6}$/.test(p));
      // Rates only for skills they have; blank / 0 = use the standard price.
      const rates = {};
      for (const [k, v] of Object.entries(b.rates && typeof b.rates === 'object' ? b.rates : {})) {
        const amount = Math.round(Number(v) * 100) / 100;
        if (skills.includes(Number(k)) && amount > 0 && amount <= 100000) rates[k] = amount;
      }
      const experienceYears = b.experienceYears === '' || b.experienceYears == null ? null : Math.min(60, Math.max(0, parseInt(b.experienceYears, 10) || 0));
      if (b2g) {
        // Area from the app: [{ state, districts }], cleaned; must not be empty.
        let areas = null;
        if (Array.isArray(b.areas)) {
          const seen = new Set();
          areas = b.areas.map((a) => ({
            state: String(a?.state || '').trim().slice(0, 80),
            districts: (Array.isArray(a?.districts) ? a.districts : []).map((d) => String(d || '').trim().replace(/\s+/g, ' ').slice(0, 120))
              .filter((d) => d && !seen.has(`${a.state}|${d.toLowerCase()}`) && seen.add(`${a.state}|${d.toLowerCase()}`)),
          })).filter((a) => a.state && a.districts.length);
          if (!areas.length) return fail(res, 400, 'Pick at least one district you work in');
        }
        await oemHelp.saveToB2g(u.phone, { name, email, experienceYears, categoryIds: skills, areas });
        oemHelp.applyB2gEngineer(u, await oemHelp.b2gEngineerByPhone(u.phone));
      }
      Object.assign(u, {
        skills, servicePincodes: [...new Set([pincode, ...pins].filter(Boolean))], experienceYears,
        companyName: b2g ? (b2g.companies.join(' / ') || null) : (String(b.companyName || '').trim().slice(0, 120) || null),
        about: String(b.about || '').trim().slice(0, 1000) || null,
        rates,
      });
    }
    u.profileComplete = true;
    await u.save();
    res.json({ success: true, user: userJson(u) });
  } catch (err) {
    console.error('m1 updateMe error:', err);
    fail(res, 500, 'Could not save your profile');
  }
};

// ---------------- B2G link (sign-up prefill) ----------------
//
// Meril One and the B2G portal share one database. When a customer signs up,
// their (OTP-verified) mobile number is looked up in B2G: a client in any
// partner's client book (the client's phone, or a linked contact person's
// mobile / alt mobile / WhatsApp), and portal users. What's found prefills
// sign-up; the customer checks or edits it, then continues. Products are the
// items on that client's B2G invoices and sales orders.

// Last 10 digits, so "+91 98765 43210", "+919876543210" and "9876543210" match.
const DIGITS10 = (col) => `RIGHT(REGEXP_REPLACE(IFNULL(${col}, ''), '[^0-9]', ''), 10)`;

// Background (segment) from the client's industry / type; the customer can change it.
function guessSegment(industry, clientType) {
  const t = String(industry || '').toLowerCase();
  if (/hospital|clinic|health|medical|nursing|pharma/.test(t)) return 'hospital';
  if (/lab|diagnos|patholog|research/.test(t)) return 'lab';
  if (/manufactur|industr|factory|plant|engineering|construction/.test(t)) return 'industry';
  if (t) return 'office';
  return clientType === 'Individual' ? 'home' : null;
}

// Product type (Meril One category) from an item name, when it's obvious.
function guessCategoryId(name, cats) {
  const t = String(name || '').toLowerCase();
  const rules = [
    [/analy[sz]er|biochem|hematolog|haematolog|immunoassay|electrolyte/, 'Analyzers'],
    [/monitor|pump|ventilator|ecg|defibrillat|surgical|stapler|suture|endo/, 'Medical Equipment'],
    [/centrifuge|microscope|incubator|autoclave|pipette/, 'Lab Equipment'],
    [/printer|laptop|desktop|computer|scanner/, 'Computers & Printers'],
    [/\b(ac|air condition)|fridge|refrigerat|washing|microwave|purifier/, 'Home Appliances'],
    [/\btv\b|television|inverter|ups|speaker/, 'Home Electronics'],
  ];
  for (const [re, catName] of rules) if (re.test(t)) return cats.find((c) => c.name === catName)?.id || null;
  return null;
}

// @route GET /api/m1/b2g-profile — what B2G knows about this mobile number.
exports.b2gProfile = async (req, res) => {
  try {
    const phone = String(req.m1User.phone).slice(-10);
    const q = (sql) => sequelize.query(sql, { replacements: { phone }, type: QueryTypes.SELECT });
    const [byClient, byContact, users, cats] = await Promise.all([
      q(`SELECT id FROM clients WHERE status = 'Active' AND ${DIGITS10('phone')} = :phone`),
      q(`SELECT l.client_id AS id, pc.name, pc.email FROM client_contact_links l
           JOIN partner_contacts pc ON pc.id = l.partner_contact_id
          WHERE ${DIGITS10('pc.mobile')} = :phone OR ${DIGITS10('pc.alt_mobile')} = :phone OR ${DIGITS10('pc.whatsapp')} = :phone`),
      q(`SELECT id, name, email FROM users WHERE is_active = 1 AND ${DIGITS10('mobile')} = :phone`),
      M1Category.findAll({ attributes: ['id', 'name'], raw: true }),
    ]);

    const contactFor = Object.fromEntries(byContact.map((c) => [c.id, c]));
    const clientIds = [...new Set([...byClient.map((c) => c.id), ...byContact.map((c) => c.id)])];
    const clients = clientIds.length ? await Client.findAll({ where: { id: clientIds, status: 'Active' }, order: [['updatedAt', 'DESC']] }) : [];
    // What each client bought: item names on their invoices / sales orders.
    const docs = clientIds.length ? await Quotation.findAll({
      where: { clientId: clientIds, docType: ['invoice', 'sales_order'], status: { [Op.ne]: 'Rejected' } },
      attributes: ['clientId', 'items', 'quotationDate'], order: [['quotationDate', 'DESC']],
    }) : [];

    const matches = clients.map((c) => {
      const items = new Map();
      for (const d of docs.filter((x) => x.clientId === c.id)) {
        for (const it of (Array.isArray(d.items) ? d.items : [])) {
          const name = String(it.name || '').trim();
          if (!name) continue;
          const key = name.toLowerCase();
          const prev = items.get(key);
          items.set(key, { name, qty: (prev?.qty || 0) + (Number(it.qty) || 0), lastBought: prev?.lastBought || d.quotationDate });
        }
      }
      const person = contactFor[c.id];
      const isIndividual = c.clientType === 'Individual';
      return {
        source: 'client', id: c.id,
        label: c.businessName,
        name: person?.name || (isIndividual ? c.businessName : ''),
        orgName: isIndividual ? '' : c.businessName,
        email: c.email || person?.email || '',
        address: c.streetAddress || '',
        city: c.city ? c.city.replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) : '',
        pincode: /^\d{6}$/.test(String(c.postalCode || '').trim()) ? String(c.postalCode).trim() : '',
        segment: guessSegment(c.industry, c.clientType),
        industry: c.industry || null,
        products: [...items.values()].map((p) => ({ ...p, categoryId: guessCategoryId(p.name, cats) })),
      };
    });

    // Portal users (partners using B2G) with this number.
    for (const u of users) {
      const profile = await PartnerProfile.findOne({ where: { userId: u.id } });
      const info = profile?.companyInfo || {};
      const addr = profile?.registeredAddress || {};
      matches.push({
        source: 'user', id: u.id,
        label: info.tradeName || info.legalName || u.name,
        name: u.name || '', orgName: info.tradeName || info.legalName || '', email: u.email || '',
        address: [addr.line1, addr.line2].filter(Boolean).join(', '),
        city: addr.city || addr.district || '', pincode: /^\d{6}$/.test(String(addr.pincode || '')) ? String(addr.pincode) : '',
        segment: 'office', industry: null, products: [],
      });
    }
    res.json({ success: true, found: matches.length > 0, matches });
  } catch (err) {
    console.error('m1 b2gProfile error:', err);
    fail(res, 500, 'Could not check B2G');
  }
};

// ---------------- Catalogue ----------------

// @route GET /api/m1/catalog?segment=  (customers: defaults to their background)
exports.catalog = async (req, res) => {
  try {
    const segment = req.query.segment || req.m1User?.segment || null;
    const cats = await M1Category.findAll({
      include: [{ model: M1Service, as: 'services', where: { isActive: true }, required: false }],
      order: [['sortOrder', 'ASC'], [{ model: M1Service, as: 'services' }, 'price', 'ASC']],
    });
    const data = cats
      .filter((c) => !segment || req.m1User?.role === 'engineer' || (c.segments || []).includes(segment))
      .map((c) => ({
        id: c.id, name: c.name, icon: c.icon, color: c.color, segments: c.segments,
        services: (c.services || []).map((s) => ({ id: s.id, name: s.name, description: s.description, price: Number(s.price), durationMins: s.durationMins })),
      }));
    res.json({ success: true, data, slots: SLOTS });
  } catch (err) {
    console.error('m1 catalog error:', err);
    fail(res, 500, 'Could not load services');
  }
};

// ---------------- Customer bookings ----------------

async function nextBookingNo() {
  // Real numbers only (M1 + digits); sample data uses M1S…, which is skipped.
  const last = await M1Booking.findOne({ where: { bookingNo: { [Op.regexp]: '^M1[0-9]+$' } }, order: [['id', 'DESC']], attributes: ['bookingNo'] });
  // Number after the "M1" prefix. Older numbers took in the prefix's "1"
  // (M11000002, M111000003); counting their digits after the extra 1s keeps
  // the sequence going (… -> M1000004).
  const digits = last ? String(last.bookingNo).slice(2).slice(-6) : '';
  let n = (Number(digits) || 0) + 1;
  // Never reuse a number that's already taken.
  while (await M1Booking.count({ where: { bookingNo: `M1${String(n).padStart(6, '0')}` } })) n += 1;
  return `M1${String(n).padStart(6, '0')}`;
}

// @route POST /api/m1/uploads/problem-photo  (multipart, field "photo")
// Returns the photo's path, which the booking then lists in `photos`.
exports.uploadProblemPhoto = (req, res) => {
  photoUpload(req, res, (err) => {
    if (err) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large (max 8 MB)' : 'Could not upload the photo');
    if (!req.file) return fail(res, 400, 'Choose a photo (JPG or PNG)');
    res.json({ success: true, path: `/uploads/m1-problems/${req.file.filename}` });
  });
};

// @route POST /api/m1/engineer/uploads/work-photo  (multipart, field "photo")
// Returns the photo's path; sent with the "complete" action as workPhotos.
exports.uploadWorkPhoto = (req, res) => {
  workPhotoUpload(req, res, (err) => {
    if (err) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large (max 8 MB)' : 'Could not upload the photo');
    if (!req.file) return fail(res, 400, 'Choose a photo (JPG or PNG)');
    res.json({ success: true, path: `/uploads/m1-work/${req.file.filename}` });
  });
};

// @route POST /api/m1/uploads/product-photo  (multipart, field "photo")
// Returns the photo as a base64 data URI (in `path`); the product form sends
// it back as `imageUrl` and it is stored in m1_products.image_data.
exports.uploadProductPhoto = (req, res) => {
  productPhotoUpload(req, res, (err) => {
    if (err) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large (max 8 MB)' : 'Could not upload the photo');
    if (!req.file) return fail(res, 400, 'Choose a photo (JPG or PNG)');
    res.json({ success: true, path: `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` });
  });
};

// @route POST /api/m1/bookings
exports.createBooking = async (req, res) => {
  try {
    const u = req.m1User;
    if (!u.profileComplete) return fail(res, 400, 'Complete your profile first');
    const b = req.body || {};
    // One or more services for this visit (serviceIds), or a single serviceId.
    const ids = [...new Set((Array.isArray(b.serviceIds) && b.serviceIds.length ? b.serviceIds : [b.serviceId]).map(Number).filter(Boolean))].slice(0, 10);
    const picked = ids.length ? await M1Service.findAll({ where: { id: ids, isActive: true }, include: [{ model: M1Category, as: 'category' }] }) : [];
    const services = ids.map((id) => picked.find((s) => s.id === id)).filter(Boolean);
    // Services are optional; describing the problem is required.
    const issueText = String(b.issue || '').trim();
    if (issueText.length < 5) return fail(res, 400, "Tell us what's wrong (a few words at least)");
    const service = services[0] || null;
    // One visit covers them all: the visit charge is the highest of theirs
    // (0 = decided by the engineer when no service was picked).
    const visitFor = (fn) => (services.length ? Math.max(...services.map(fn)) : 0);
    const address = String(b.address || u.address || '').trim();
    const city = String(b.city || u.city || '').trim();
    const pincode = String(b.pincode || u.pincode || '').trim();
    if (!address) return fail(res, 400, 'Enter the service address');
    if (!city || !/^\d{6}$/.test(pincode)) return fail(res, 400, 'Enter the city and a 6-digit pincode');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.scheduledDate || '') || b.scheduledDate < today()) return fail(res, 400, 'Choose a date from today onwards');
    if (!SLOTS.includes(b.slot)) return fail(res, 400, 'Choose a time');
    const contactPhone = cleanPhone(b.contactPhone || u.phone);

    // Booked for one of My Products: remember it and its OEM.
    let product = null;
    let oem = null;
    if (b.productId) {
      product = await M1Product.findOne({ where: { id: b.productId, customerId: u.id } });
      if (product) oem = await oemHelp.resolveOem(product, u);
    }

    // The customer doesn't pick an engineer: the request goes to nearby
    // engineers of the product's OEM (B2G), or any B2G engineer nearby with
    // the skill when the product has no OEM in B2G. Engineers accept it.
    b.engineerId = null;
    b.oemEngineerId = null;
    let oemEngineer = null;
    let oemApp = null;
    if (b.oemEngineerId) {
      if (!oem) return fail(res, 400, "This engineer isn't from your product's company. Please choose another.");
      const { list } = await oemHelp.engineersFor(oem.userId, { city, pincode, address });
      const hit = list.find((x) => x.engineer.id === Number(b.oemEngineerId));
      if (!hit) return fail(res, 400, "This engineer doesn't cover your area. Please choose another.");
      oemEngineer = hit.engineer;
      oemApp = hit.appUser;
      const busy = await busySlots(oemApp?.id || null, b.scheduledDate, null, [oemEngineer.id]);
      if ((busy[b.scheduledDate] || []).includes(b.slot)) {
        return fail(res, 409, `${oemEngineer.name} is already booked at this time. Please pick another time.`);
      }
    }

    // The engineer the customer picked (optional): must still be able to do it.
    let chosen = null;
    if (b.engineerId && !oemEngineer) {
      chosen = await M1User.findOne({ where: { id: b.engineerId, role: 'engineer', profileComplete: true } });
      if (chosen && !(await oemHelp.b2gEngineerByPhone(chosen.phone))) chosen = null;
      if (!chosen || !services.every((s) => (chosen.skills || []).includes(s.categoryId)) || !coversArea(chosen, city, pincode)) {
        return fail(res, 400, "This engineer doesn't cover this service or area. Please choose another.");
      }
      const busy = await busySlots(chosen.id, b.scheduledDate);
      if ((busy[b.scheduledDate] || []).includes(b.slot)) {
        return fail(res, 409, `${chosen.name} is already booked at this time. Please pick another time.`);
      }
    }

    const booking = await M1Booking.create({
      bookingNo: await nextBookingNo(),
      customerId: u.id, serviceId: service ? service.id : null, segment: u.segment,
      // Category: the service's, else the product's (or what the app sent).
      categoryId: service ? service.categoryId : (product?.categoryId || Number(b.categoryId) || null),
      issue: issueText,
      equipment: b.equipment && (b.equipment.brand || b.equipment.model || b.equipment.serialNo) ? {
        brand: String(b.equipment.brand || '').trim(), model: String(b.equipment.model || '').trim(), serialNo: String(b.equipment.serialNo || '').trim(),
      } : null,
      address, city, pincode,
      contactName: String(b.contactName || u.name || '').trim() || null, contactPhone,
      scheduledDate: b.scheduledDate, slot: b.slot,
      startOtp: String(crypto.randomInt(1000, 10000)),
      requestedEngineerId: chosen ? chosen.id : oemApp ? oemApp.id : null,
      productId: product ? product.id : null,
      oemUserId: oem ? oem.userId : null,
      oemEngineerId: oemEngineer ? oemEngineer.id : null,
      services: services.map((s) => ({ id: s.id, name: s.name, price: Number(s.price) })),
      photos: (Array.isArray(b.photos) ? b.photos : []).filter((p) => PHOTO_PATH.test(String(p)) && fs.existsSync(path.join(PROBLEM_DIR, path.basename(p)))).slice(0, 5),
      visitCharge: chosen ? visitFor((s) => rateFor(chosen, s)) : visitFor((s) => Number(s.price)),
      timeline: [{
        status: 'requested', at: new Date().toISOString(),
        ...(chosen ? { note: `Sent to ${chosen.name}` } : oemEngineer ? { note: `Sent to ${oemEngineer.name} (${oem.name} engineer)` } : {}),
      }],
    });
    const full = await M1Booking.findByPk(booking.id, { include: customerRefs() });
    await notifyCustomer(full, 'placed', 'Booking placed 📝',
      `We're finding an engineer near you for your ${serviceName(full)} on ${whenLabel(full.scheduledDate, full.slot)}. Booking ${full.bookingNo}.`);
    res.json({ success: true, data: bookingJson(full, 'customer') });
  } catch (err) {
    console.error('m1 createBooking error:', err);
    fail(res, 500, 'Could not create the booking');
  }
};

// @route GET /api/m1/bookings
exports.myBookings = async (req, res) => {
  try {
    const rows = await M1Booking.findAll({ where: { customerId: req.m1User.id }, include: customerRefs(), order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: rows.map((b) => bookingJson(b, 'customer')) });
  } catch (err) {
    console.error('m1 myBookings error:', err);
    fail(res, 500, 'Could not load bookings');
  }
};

// @route GET /api/m1/bookings/:id
exports.getBooking = async (req, res) => {
  try {
    const b = await M1Booking.findOne({ where: { id: req.params.id, customerId: req.m1User.id }, include: customerRefs() });
    if (!b) return fail(res, 404, 'Booking not found');
    res.json({ success: true, data: bookingJson(b, 'customer') });
  } catch (err) {
    console.error('m1 getBooking error:', err);
    fail(res, 500, 'Could not load the booking');
  }
};

// @route POST /api/m1/bookings/:id/cancel  { reason }
exports.cancelBooking = async (req, res) => {
  try {
    const b = await M1Booking.findOne({ where: { id: req.params.id, customerId: req.m1User.id }, include: [{ model: M1Service, as: 'service', attributes: ['name'] }] });
    if (!b) return fail(res, 404, 'Booking not found');
    if (!['requested', 'accepted', 'on_the_way'].includes(b.status)) return fail(res, 400, "This booking can't be cancelled now");
    b.status = 'cancelled';
    b.cancelReason = String(req.body?.reason || '').trim() || 'Cancelled by customer';
    stamp(b, 'cancelled', b.cancelReason);
    await b.save();
    await notifyCustomer(b, 'cancelled', 'Booking cancelled ❌', `Your booking ${b.bookingNo} (${serviceName(b)}) is cancelled.`);
    res.json({ success: true });
  } catch (err) {
    console.error('m1 cancelBooking error:', err);
    fail(res, 500, 'Could not cancel');
  }
};

// @route POST /api/m1/bookings/:id/rate  { rating 1-5, review }
exports.rateBooking = async (req, res) => {
  try {
    const rating = Number(req.body?.rating);
    if (!(rating >= 1 && rating <= 5) || !Number.isInteger(rating)) return fail(res, 400, 'Choose 1 to 5 stars');
    const b = await M1Booking.findOne({ where: { id: req.params.id, customerId: req.m1User.id } });
    if (!b) return fail(res, 404, 'Booking not found');
    if (b.status !== 'completed') return fail(res, 400, 'You can rate after the job is completed');
    if (b.rating) return fail(res, 400, 'Already rated');
    b.rating = rating;
    b.review = String(req.body?.review || '').trim() || null;
    await b.save();
    if (b.engineerId) await M1User.increment({ ratingSum: rating, ratingCount: 1 }, { where: { id: b.engineerId } });
    res.json({ success: true });
  } catch (err) {
    console.error('m1 rateBooking error:', err);
    fail(res, 500, 'Could not save the rating');
  }
};

// @route POST /api/m1/bookings/:id/reschedule  { accept: true|false }
// The customer's answer to the engineer's reschedule request.
exports.answerReschedule = async (req, res) => {
  try {
    const b = await M1Booking.findOne({ where: { id: req.params.id, customerId: req.m1User.id }, include: customerRefs() });
    if (!b) return fail(res, 404, 'Booking not found');
    const rq = b.rescheduleRequest;
    if (!rq || rq.status !== 'pending') return fail(res, 400, 'There is no reschedule request to answer');
    if (!['accepted', 'on_the_way'].includes(b.status)) return fail(res, 400, 'This booking can no longer be rescheduled');
    const accept = !!req.body?.accept;
    if (accept) {
      if (rq.date < today() || (rq.date === today() && Number(String(rq.slot).slice(0, 2)) <= nowHourIST())) {
        b.rescheduleRequest = { ...rq, status: 'expired', answeredAt: new Date().toISOString() };
        stamp(b, b.status, 'The suggested time has passed. Ask the engineer for a new time');
        await b.save();
        return fail(res, 400, 'The suggested time has already passed. The engineer will need to suggest a new time');
      }
      b.scheduledDate = rq.date;
      b.slot = rq.slot;
      stamp(b, b.status, `Customer accepted the new time: ${whenLabel(rq.date, rq.slot)}`);
      await notifyCustomer(b, 'rescheduled', 'Visit time updated 📅', `Your visit is now on ${whenLabel(rq.date, rq.slot)}.`);
    } else {
      stamp(b, b.status, `Customer kept the original time: ${whenLabel(rq.fromDate, rq.fromSlot)}`);
      await notifyCustomer(b, 'rescheduled', 'Original time kept 📅', `Your visit stays on ${whenLabel(rq.fromDate, rq.fromSlot)}.`);
    }
    b.rescheduleRequest = { ...rq, status: accept ? 'accepted' : 'rejected', answeredAt: new Date().toISOString() };
    await b.save();
    res.json({ success: true, data: bookingJson(b, 'customer') });
  } catch (err) {
    console.error('m1 answerReschedule error:', err);
    fail(res, 500, 'Could not save your answer');
  }
};

// ---------------- OEM engineers for a product ----------------

// @route GET /api/m1/products/:id/oem-engineers
// The product's OEM company and its service engineers who cover the
// customer's area (from B2G Service Management).
exports.productOemEngineers = async (req, res) => {
  try {
    const u = req.m1User;
    const product = await M1Product.findOne({ where: { id: req.params.id, customerId: u.id } });
    if (!product) return fail(res, 404, 'Product not found');
    const oem = await oemHelp.resolveOem(product, u);
    if (!oem) return res.json({ success: true, oem: null, engineers: [], area: { city: u.city, state: oemHelp.stateForPincode(u.pincode) } });
    const { state, list } = await oemHelp.engineersFor(oem.userId, { city: u.city, pincode: u.pincode, address: u.address });
    const jobsDone = await jobsDoneFor(list.map((x) => x.appUser?.id).filter(Boolean));
    res.json({
      success: true,
      oem,
      area: { city: u.city, state },
      engineers: list.map(({ engineer: e, match, matchedArea, appUser }) => ({
        id: e.id,
        name: e.name,
        companyName: oem.name,
        match, // 'district' | 'state'
        coverage: match === 'district' ? matchedArea.district : matchedArea.state,
        districts: e.areas.length,
        onApp: !!appUser,
        online: !!appUser?.isAvailable,
        rating: appUser ? ratingOf(appUser) : null,
        ratingCount: appUser?.ratingCount || 0,
        jobsDone: appUser ? jobsDone[appUser.id] || 0 : 0,
        experienceYears: appUser?.experienceYears || null,
      })),
    });
  } catch (err) {
    console.error('m1 productOemEngineers error:', err);
    fail(res, 500, 'Could not load the engineers');
  }
};

// @route GET /api/m1/oem-engineers/:id/busy — booked start hours, per date.
exports.oemEngineerBusy = async (req, res) => {
  try {
    const e = await require('../models').ServiceEngineer.findOne({ where: { id: req.params.id, status: 'Active' } });
    if (!e) return fail(res, 404, 'Engineer not found');
    const app = await M1User.findOne({ where: { role: 'engineer', phone: e.phone } });
    res.json({ success: true, data: await busySlots(app?.id || null, today(), null, [e.id]) });
  } catch (err) {
    console.error('m1 oemEngineerBusy error:', err);
    fail(res, 500, "Could not load the engineer's schedule");
  }
};

// ---------------- Choosing an engineer ----------------

const customerRefs = () => withRefs([
  { model: M1User, as: 'engineer' },
  { model: M1User, as: 'requestedEngineer', attributes: ['id', 'name', 'companyName'] },
  { model: require('../models').ServiceEngineer, as: 'oemEngineer', attributes: ['id', 'name'] },
]);

// Does this engineer work where the job is? Same city, or a pincode they cover.
// Does this engineer work where the job is? Their B2G districts, same city,
// or a pincode they cover.
const engDistricts = (eng) => (eng.b2gEngineer?.areas || []).flatMap((a) => a.districts);
const coversArea = (eng, city, pincode) =>
  (eng.servicePincodes || []).includes(String(pincode))
  || (!!eng.city && norm(eng.city) === norm(city))
  || engDistricts(eng).some((d) => norm(d) === norm(city));

// Their visit charge for a service: their rate for its category, else the
// service's standard price.
const rateFor = (eng, service) => {
  const r = Number((eng.rates || {})[service.categoryId]);
  return r > 0 ? r : Number(service.price);
};

// Completed-job counts per engineer.
async function jobsDoneFor(ids) {
  if (!ids.length) return {};
  const rows = await M1Booking.findAll({
    where: { engineerId: ids, status: 'completed' },
    attributes: ['engineerId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['engineerId'], raw: true,
  });
  return Object.fromEntries(rows.map((r) => [r.engineerId, Number(r.n)]));
}

// Card shown in the list. `rate` = what this engineer charges: their own rate
// for the category if set; else the chosen service's standard price; else
// the category's cheapest service ("from"). With no category: their lowest
// across all skills ("from").
function engineerCard(e, { categoryId, cats, jobsDone, service }) {
  const services = cats.flatMap((c) => c.services || []);
  const lowest = (catId) => {
    const prices = services.filter((s) => s.categoryId === catId && s.isActive).map((s) => Number(s.price));
    return prices.length ? Math.min(...prices) : 0;
  };
  const own = (catId) => Number((e.rates || {})[catId]) || 0;
  const rateForCat = (catId) => own(catId) || lowest(catId);
  const skillIds = e.skills || [];
  let rate;
  let rateIsFrom;
  if (!categoryId) { rate = Math.min(...skillIds.map(rateForCat).filter((n) => n > 0), Infinity); rateIsFrom = true; }
  else if (own(categoryId)) { rate = own(categoryId); rateIsFrom = false; }
  else if (service) { rate = Number(service.price); rateIsFrom = false; }
  else { rate = lowest(categoryId); rateIsFrom = true; }
  return {
    id: e.id,
    name: e.name,
    companyName: e.companyName,
    experienceYears: e.experienceYears,
    city: e.city,
    online: !!e.isAvailable,
    rating: ratingOf(e),
    ratingCount: e.ratingCount,
    jobsDone: jobsDone[e.id] || 0,
    rate: Number.isFinite(rate) ? rate : null,
    rateIsFrom,
    // own = their own rate; otherwise `rate` is the cheapest standard price ("from").
    skills: cats.filter((c) => skillIds.includes(c.id)).map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, rate: rateForCat(c.id), own: !!own(c.id) })),
  };
}

// @route GET /api/m1/engineers?categoryId=&serviceId=
// Engineers who can do this category and cover the customer's area. Online
// first, then best rated, then most jobs done. No category = any skill.
exports.listEngineers = async (req, res) => {
  try {
    const u = req.m1User;
    let categoryId = parseInt(req.query.categoryId, 10) || null;
    let service = null;
    if (req.query.serviceId) {
      service = await M1Service.findByPk(req.query.serviceId, { attributes: ['categoryId', 'price'] });
      if (!service) return fail(res, 404, 'Service not found');
      categoryId = service.categoryId;
    }
    const [engineers, cats] = await Promise.all([
      M1User.findAll({ where: { role: 'engineer', profileComplete: true } }),
      M1Category.findAll({ include: [{ model: M1Service, as: 'services' }], order: [['sortOrder', 'ASC']] }),
    ]);
    const city = req.query.city || u.city;
    const pincode = req.query.pincode || u.pincode;
    // Only engineers still Active in B2G (Service Management) can take jobs.
    const activePhones = new Set((await require('../models').ServiceEngineer.findAll({ where: { status: 'Active' }, attributes: ['phone'], raw: true })).map((x) => x.phone));
    const matching = engineers.filter((e) => activePhones.has(e.phone) && coversArea(e, city, pincode) && (!categoryId || (e.skills || []).includes(categoryId)));
    const jobsDone = await jobsDoneFor(matching.map((e) => e.id));
    const data = matching
      .map((e) => engineerCard(e, { categoryId, cats, jobsDone, service }))
      .sort((a, b) => Number(b.online) - Number(a.online) || (b.rating || 0) - (a.rating || 0) || b.jobsDone - a.jobsDone);
    res.json({ success: true, data, area: { city, pincode } });
  } catch (err) {
    console.error('m1 listEngineers error:', err);
    fail(res, 500, 'Could not load engineers');
  }
};

// @route GET /api/m1/engineers/:id/busy — start hours already taken, per
// date, so the Book screen can lock them: { "2026-10-07": ["10:00", ...] }.
exports.engineerBusy = async (req, res) => {
  try {
    const e = await M1User.findOne({ where: { id: req.params.id, role: 'engineer' }, attributes: ['id'] });
    if (!e) return fail(res, 404, 'Engineer not found');
    res.json({ success: true, data: await busySlots(e.id, today()) });
  } catch (err) {
    console.error('m1 engineerBusy error:', err);
    fail(res, 500, 'Could not load the engineer\'s schedule');
  }
};

// @route GET /api/m1/engineers/:id?categoryId=
// Full profile: about, rate per skill, and the latest customer reviews.
exports.engineerProfile = async (req, res) => {
  try {
    const e = await M1User.findOne({ where: { id: req.params.id, role: 'engineer', profileComplete: true } });
    if (!e || !(await oemHelp.b2gEngineerByPhone(e.phone))) return fail(res, 404, 'Engineer not found');
    const categoryId = parseInt(req.query.categoryId, 10) || null;
    const [cats, jobsDone, reviews, works] = await Promise.all([
      M1Category.findAll({ include: [{ model: M1Service, as: 'services' }], order: [['sortOrder', 'ASC']] }),
      jobsDoneFor([e.id]),
      // Every rating they've received. Customer names are never sent.
      M1Booking.findAll({
        where: { engineerId: e.id, status: 'completed', rating: { [Op.ne]: null } },
        attributes: ['rating', 'review', 'updatedAt'],
        include: [{ model: M1Service, as: 'service', attributes: ['name'] }],
        order: [['updatedAt', 'DESC']],
      }),
      // Every job they've completed (no customer details), newest first.
      M1Booking.findAll({
        where: { engineerId: e.id, status: 'completed' },
        attributes: ['id', 'scheduledDate', 'rating', 'equipment', 'timeline'],
        include: [{ model: M1Service, as: 'service', attributes: ['name'] }, { model: M1Category, as: 'category', attributes: ['name', 'icon', 'color'] }],
        order: [['scheduledDate', 'DESC'], ['id', 'DESC']], limit: 100,
      }),
    ]);
    res.json({
      success: true,
      data: {
        ...engineerCard(e, { categoryId, cats, jobsDone }),
        about: e.about,
        memberSince: e.createdAt,
        reviews: reviews.map((r) => ({ rating: r.rating, review: r.review, service: r.service?.name || null, date: r.updatedAt })),
        // How many 5-star, 4-star … ratings.
        ratingBreakdown: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: reviews.filter((r) => r.rating === stars).length })),
        works: works.map((w) => ({
          id: w.id,
          service: w.service?.name || null,
          category: w.category ? { name: w.category.name, icon: w.category.icon, color: w.category.color } : null,
          brand: w.equipment?.brand || null,
          date: (w.timeline || []).filter((t) => t.status === 'completed').at(-1)?.at || w.scheduledDate,
          rating: w.rating,
        })),
      },
    });
  } catch (err) {
    console.error('m1 engineerProfile error:', err);
    fail(res, 500, 'Could not load the engineer');
  }
};

// ---------------- Customer products ("My Products") ----------------

// Categories are keyed as strings so basic and custom ones share one list:
// "b3" = basic category 3 (m1_categories), "c7" = custom category 7.
const CUSTOM_ICON = 'pricetag';
const CUSTOM_COLOR = '#7C3AED';
const basicCat = (c) => ({ key: `b${c.id}`, name: c.name, icon: c.icon, color: c.color, custom: false });
const customCat = (c) => ({ key: `c${c.id}`, name: c.name, icon: CUSTOM_ICON, color: CUSTOM_COLOR, custom: true });

const productJson = (p) => ({
  id: p.id,
  name: p.name,
  categoryId: p.categoryId,
  customCategoryId: p.customCategoryId,
  // The category this product sits in, basic or custom (null = none).
  category: p.category ? { id: p.category.id, name: p.category.name, icon: p.category.icon, color: p.category.color }
    : p.customCategory ? { id: p.customCategory.id, name: p.customCategory.name, icon: CUSTOM_ICON, color: CUSTOM_COLOR } : null,
  categoryKey: p.categoryId ? `b${p.categoryId}` : p.customCategoryId ? `c${p.customCategoryId}` : null,
  brand: p.brand, model: p.model, serialNo: p.serialNo,
  purchaseDate: p.purchaseDate, warrantyUntil: p.warrantyUntil,
  location: p.location, notes: p.notes,
  imageUrl: p.imageData || null, // base64 data URI
  createdAt: p.createdAt,
});
const productInclude = [
  { model: M1Category, as: 'category', attributes: ['id', 'name', 'icon', 'color'] },
  { model: M1CustomCategory, as: 'customCategory', attributes: ['id', 'name'] },
];

// @route GET /api/m1/product-categories
// The basic categories for this customer's background, then their own, each
// with how many products they've saved in it.
exports.productCategories = async (req, res) => {
  try {
    const u = req.m1User;
    const [basics, customs, counts] = await Promise.all([
      M1Category.findAll({ order: [['sortOrder', 'ASC']] }),
      M1CustomCategory.findAll({ where: { customerId: u.id }, order: [['createdAt', 'ASC']] }),
      M1Product.findAll({
        where: { customerId: u.id },
        attributes: ['categoryId', 'customCategoryId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
        group: ['categoryId', 'customCategoryId'], raw: true,
      }),
    ]);
    const count = {};
    let uncategorized = 0;
    for (const r of counts) {
      const key = r.categoryId ? `b${r.categoryId}` : r.customCategoryId ? `c${r.customCategoryId}` : null;
      if (key) count[key] = Number(r.n); else uncategorized += Number(r.n);
    }
    // A basic category outside their background still shows if they used it.
    const data = [
      ...basics.filter((c) => (c.segments || []).includes(u.segment) || count[`b${c.id}`]).map(basicCat),
      ...customs.map(customCat),
    ].map((c) => ({ ...c, products: count[c.key] || 0 }));
    res.json({ success: true, data, uncategorized });
  } catch (err) {
    console.error('m1 productCategories error:', err);
    fail(res, 500, 'Could not load categories');
  }
};

// @route POST /api/m1/product-categories  { name }
exports.createProductCategory = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!name) return fail(res, 400, 'Enter a category name');
    const [mine, basics] = await Promise.all([
      M1CustomCategory.findAll({ where: { customerId: req.m1User.id }, attributes: ['name'] }),
      M1Category.findAll({ attributes: ['name', 'segments'] }),
    ]);
    const taken = [...mine.map((c) => c.name), ...basics.filter((c) => (c.segments || []).includes(req.m1User.segment)).map((c) => c.name)];
    if (taken.some((t) => norm(t) === norm(name))) return fail(res, 400, `You already have a "${name}" category`);
    const c = await M1CustomCategory.create({ customerId: req.m1User.id, name });
    res.json({ success: true, data: { ...customCat(c), products: 0 } });
  } catch (err) {
    console.error('m1 createProductCategory error:', err);
    fail(res, 500, 'Could not add the category');
  }
};

// @route DELETE /api/m1/product-categories/:id — only the customer's own, and
// only when empty, so no product loses its category by accident.
exports.deleteProductCategory = async (req, res) => {
  try {
    const c = await M1CustomCategory.findOne({ where: { id: req.params.id, customerId: req.m1User.id } });
    if (!c) return fail(res, 404, 'Category not found');
    const n = await M1Product.count({ where: { customerId: req.m1User.id, customCategoryId: c.id } });
    if (n) return fail(res, 400, `Move or delete the ${n} product${n === 1 ? '' : 's'} in "${c.name}" first`);
    await c.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('m1 deleteProductCategory error:', err);
    fail(res, 500, 'Could not delete the category');
  }
};

// Validates and cleans the form; returns { error } or { values }.
// The category comes as categoryKey ("b3" / "c7"), or a plain categoryId.
async function productValues(b, customerId) {
  const str = (v, max = 255) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };
  const date = (v) => (v ? String(v).trim() : '');
  const name = str(b.name);
  if (!name) return { error: 'Enter the product name' };
  for (const [label, v] of [['purchase date', date(b.purchaseDate)], ['warranty date', date(b.warrantyUntil)]]) {
    // Round-trip check also rejects dates like 31-02 that JS would roll over.
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v).getTime()) || new Date(v).toISOString().slice(0, 10) !== v)) return { error: `Enter a valid ${label}` };
  }
  const key = String(b.categoryKey || (b.categoryId ? `b${b.categoryId}` : ''));
  let categoryId = null;
  let customCategoryId = null;
  if (/^b\d+$/.test(key)) {
    categoryId = parseInt(key.slice(1), 10);
    if (!(await M1Category.findByPk(categoryId, { attributes: ['id'] }))) return { error: 'That category no longer exists' };
  } else if (/^c\d+$/.test(key)) {
    customCategoryId = parseInt(key.slice(1), 10);
    if (!(await M1CustomCategory.findOne({ where: { id: customCategoryId, customerId }, attributes: ['id'] }))) return { error: 'That category no longer exists' };
  }
  return {
    values: {
      name, categoryId, customCategoryId,
      brand: str(b.brand), model: str(b.model), serialNo: str(b.serialNo),
      purchaseDate: date(b.purchaseDate) || null, warrantyUntil: date(b.warrantyUntil) || null,
      location: str(b.location), notes: str(b.notes, 2000),
      // A base64 image data URI (from /uploads/product-photo); '' / null removes it.
      imageData: (() => { const v = String(b.imageUrl || ''); return v.length <= MAX_PRODUCT_PHOTO_CHARS && PRODUCT_PHOTO_DATA.test(v) ? v : null; })(),
    },
  };
}

// @route GET /api/m1/products
// Adds what this customer bought in B2G (invoice / sales order lines of the
// B2G client(s) with their phone number) to My Products, so new purchases
// show up without signing up again. Each line is added once (b2gImported);
// a product with the same name already in My Products is not added twice.
async function syncB2gProducts(u) {
  const phone = String(u.phone || '').replace(/\D/g, '').slice(-10);
  if (!/^\d{10}$/.test(phone)) return;
  const q = (sql) => sequelize.query(sql, { replacements: { phone }, type: QueryTypes.SELECT });
  const [byClient, byContact] = await Promise.all([
    q(`SELECT id FROM clients WHERE status = 'Active' AND ${DIGITS10('phone')} = :phone`),
    q(`SELECT l.client_id AS id FROM client_contact_links l JOIN partner_contacts pc ON pc.id = l.partner_contact_id
        WHERE ${DIGITS10('pc.mobile')} = :phone OR ${DIGITS10('pc.alt_mobile')} = :phone OR ${DIGITS10('pc.whatsapp')} = :phone`),
  ]);
  const clientIds = [...new Set([...byClient, ...byContact].map((c) => c.id))];
  if (!clientIds.length) return;
  const docs = await Quotation.findAll({
    where: { clientId: clientIds, docType: ['invoice', 'sales_order'], status: { [Op.ne]: 'Rejected' } },
    attributes: ['id', 'userId', 'items', 'quotationDate'], order: [['quotationDate', 'ASC']],
  });
  const done = new Set(Array.isArray(u.b2gImported) ? u.b2gImported : []);
  const have = new Set((await M1Product.findAll({ where: { customerId: u.id }, attributes: ['name'], raw: true })).map((p) => p.name.trim().toLowerCase()));
  const cats = await M1Category.findAll({ attributes: ['id', 'name'], raw: true });
  let changed = false;
  for (const d of docs) {
    for (const it of (Array.isArray(d.items) ? d.items : [])) {
      const name = String(it.name || '').trim();
      if (!name) continue;
      const key = `${d.id}:${name.toLowerCase()}`;
      if (done.has(key)) continue;
      done.add(key); changed = true;
      if (have.has(name.toLowerCase())) continue;
      have.add(name.toLowerCase());
      await M1Product.create({
        customerId: u.id, name: name.slice(0, 255), categoryId: guessCategoryId(name, cats), oemUserId: d.userId,
        purchaseDate: d.quotationDate || null, notes: `Bought through Meril B2G (qty ${Number(it.qty) || 1})`,
      });
    }
  }
  if (changed) await u.update({ b2gImported: [...done] });
}

exports.myProducts = async (req, res) => {
  try {
    await syncB2gProducts(req.m1User).catch((err) => console.error('m1 b2g product sync error:', err.message));
    const rows = await M1Product.findAll({ where: { customerId: req.m1User.id }, include: productInclude, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: rows.map(productJson) });
  } catch (err) {
    console.error('m1 myProducts error:', err);
    fail(res, 500, 'Could not load your products');
  }
};

// @route POST /api/m1/products  { name, categoryId, brand, model, serialNo, purchaseDate, warrantyUntil, location, notes }
exports.createProduct = async (req, res) => {
  try {
    const { error, values } = await productValues(req.body || {}, req.m1User.id);
    if (error) return fail(res, 400, error);
    const p = await M1Product.create({ ...values, customerId: req.m1User.id });
    const full = await M1Product.findByPk(p.id, { include: productInclude });
    res.json({ success: true, data: productJson(full) });
  } catch (err) {
    console.error('m1 createProduct error:', err);
    fail(res, 500, 'Could not save the product');
  }
};

// @route PUT /api/m1/products/:id
exports.updateProduct = async (req, res) => {
  try {
    const p = await M1Product.findOne({ where: { id: req.params.id, customerId: req.m1User.id } });
    if (!p) return fail(res, 404, 'Product not found');
    const { error, values } = await productValues(req.body || {}, req.m1User.id);
    if (error) return fail(res, 400, error);
    await p.update(values);
    const full = await M1Product.findByPk(p.id, { include: productInclude });
    res.json({ success: true, data: productJson(full) });
  } catch (err) {
    console.error('m1 updateProduct error:', err);
    fail(res, 500, 'Could not save the product');
  }
};

// @route DELETE /api/m1/products/:id
exports.deleteProduct = async (req, res) => {
  try {
    const n = await M1Product.destroy({ where: { id: req.params.id, customerId: req.m1User.id } });
    if (!n) return fail(res, 404, 'Product not found');
    res.json({ success: true });
  } catch (err) {
    console.error('m1 deleteProduct error:', err);
    fail(res, 500, 'Could not delete the product');
  }
};

// ---------------- Engineer jobs ----------------

// Bookings this engineer can take: requested, matching skill, in their area,
// not declined by them, not in the past.
// Open requests (no engineer picked) in their skills and area, plus any
// request a customer sent to them by name.
// oemUserIds: the B2G companies this engineer works for — a request for a
// product of one OEM only goes to that OEM's engineers.
function availableWhere(eng, oemIds = [], oemUserIds = []) {
  const pins = eng.servicePincodes || [];
  return {
    status: 'requested',
    scheduledDate: { [Op.gte]: today() },
    [Op.or]: [
      { requestedEngineerId: eng.id },
      // Held for them as an OEM's service engineer (same mobile number).
      ...(oemIds.length ? [{ oemEngineerId: oemIds }] : []),
      {
        requestedEngineerId: null,
        oemEngineerId: null,
        [Op.and]: [
          { [Op.or]: [{ oemUserId: null }, ...(oemUserIds.length ? [{ oemUserId: oemUserIds }] : [])] },
          // No category (no service, custom product): any skill may take it.
          { [Op.or]: [{ categoryId: eng.skills || [] }, { categoryId: null }] },
        ],
        [Op.or]: [
          ...(pins.length ? [{ pincode: pins }] : []),
          ...(eng.city || engDistricts(eng).length
            ? [sequelize.where(sequelize.fn('LOWER', sequelize.col('M1Booking.city')), { [Op.in]: [...new Set([eng.city, ...engDistricts(eng)].filter(Boolean).map(norm))] })]
            : []),
        ],
      },
    ],
  };
}
const notDeclinedBy = (id) => (b) => !(b.declinedBy || []).includes(id);

// @route PUT /api/m1/engineer/availability  { isAvailable }
exports.setAvailability = async (req, res) => {
  try {
    const u = req.m1User;
    if (!u.profileComplete) return fail(res, 400, 'Complete your profile first');
    u.isAvailable = !!req.body?.isAvailable;
    await u.save();
    res.json({ success: true, user: userJson(u) });
  } catch (err) {
    console.error('m1 setAvailability error:', err);
    fail(res, 500, 'Could not update availability');
  }
};

// @route GET /api/m1/engineer/jobs/available
exports.availableJobs = async (req, res) => {
  try {
    const eng = req.m1User;
    if (!eng.profileComplete || !eng.isAvailable) return res.json({ success: true, data: [], online: !!eng.isAvailable });
    const oemIds = await oemHelp.oemIdsForPhone(eng.phone);
    const rows = await M1Booking.findAll({
      where: availableWhere(eng, oemIds, await oemHelp.oemUserIdsForPhone(eng.phone)),
      include: withRefs([{ model: M1User, as: 'customer', attributes: ['name', 'orgName', 'phone'] }]),
      order: [['scheduledDate', 'ASC'], ['createdAt', 'ASC']],
    });
    // Requests sent to them by name (or held for them as an OEM engineer) first.
    const data = rows.filter(notDeclinedBy(eng.id))
      .map((b) => ({ ...bookingJson(b, 'engineer', eng.id), ...(oemIds.includes(b.oemEngineerId) ? { direct: true } : {}) }))
      .sort((a, b) => Number(b.direct) - Number(a.direct));
    res.json({ success: true, data, online: true });
  } catch (err) {
    console.error('m1 availableJobs error:', err);
    fail(res, 500, 'Could not load jobs');
  }
};

// @route GET /api/m1/engineer/jobs/mine
exports.myJobs = async (req, res) => {
  try {
    const rows = await M1Booking.findAll({
      where: { engineerId: req.m1User.id },
      include: withRefs([{ model: M1User, as: 'customer', attributes: ['name', 'orgName', 'phone'] }]),
      order: [['scheduledDate', 'DESC'], ['createdAt', 'DESC']],
    });
    const data = rows.map((b) => bookingJson(b, 'engineer'));
    const done = data.filter((j) => j.status === 'completed');
    res.json({
      success: true, data,
      stats: { active: data.filter((j) => ['accepted', 'on_the_way', 'in_progress'].includes(j.status)).length, completed: done.length, earned: done.reduce((s, j) => s + (j.finalAmount || 0), 0) },
    });
  } catch (err) {
    console.error('m1 myJobs error:', err);
    fail(res, 500, 'Could not load your jobs');
  }
};

async function loadJob(req, res) {
  const b = await M1Booking.findOne({ where: { id: req.params.id }, include: withRefs([{ model: M1User, as: 'customer', attributes: ['name', 'orgName', 'phone'] }]) });
  if (!b) { fail(res, 404, 'Job not found'); return null; }
  return b;
}

// @route GET /api/m1/engineer/jobs/:id
exports.getJob = async (req, res) => {
  try {
    const b = await loadJob(req, res); if (!b) return;
    const eng = req.m1User;
    const mine = b.engineerId === eng.id;
    const oemIds = await oemHelp.oemIdsForPhone(eng.phone);
    const offered = b.status === 'requested' && (await M1Booking.count({ where: { id: b.id, ...availableWhere(eng, oemIds, await oemHelp.oemUserIdsForPhone(eng.phone)) } })) > 0;
    if (!mine && !offered) return fail(res, 404, 'Job not found');
    res.json({ success: true, data: bookingJson(b, 'engineer', eng.id) });
  } catch (err) {
    console.error('m1 getJob error:', err);
    fail(res, 500, 'Could not load the job');
  }
};

// @route POST /api/m1/engineer/jobs/:id/accept — first engineer wins.
exports.acceptJob = async (req, res) => {
  try {
    const eng = req.m1User;
    if (!eng.isAvailable) return fail(res, 400, 'Go online to accept jobs');
    const oemIds = await oemHelp.oemIdsForPhone(eng.phone);
    const job = await M1Booking.findOne({ where: { id: req.params.id, ...availableWhere(eng, oemIds, await oemHelp.oemUserIdsForPhone(eng.phone)) }, attributes: ['id', 'scheduledDate', 'slot'] });
    if (!job) return fail(res, 409, 'This job is no longer available');
    const busy = await busySlots(eng.id, job.scheduledDate, job.id, oemIds);
    if ((busy[job.scheduledDate] || []).includes(slotStart(job.slot))) {
      return fail(res, 409, 'You already have a job at this time');
    }
    const [n] = await M1Booking.update({ status: 'accepted', engineerId: eng.id, requestedEngineerId: null }, { where: { id: req.params.id, status: 'requested', engineerId: null } });
    if (!n) return fail(res, 409, 'Another engineer accepted this job first');
    const b = await loadJob(req, res); if (!b) return;
    stamp(b, 'accepted', eng.name); await b.save();
    await notifyCustomer(b, 'accepted', 'Engineer assigned ✅',
      `${eng.name}${eng.companyName ? ` (${eng.companyName})` : ''} accepted your ${serviceName(b)} on ${whenLabel(b.scheduledDate, b.slot)}.`);
    res.json({ success: true, data: bookingJson(b, 'engineer') });
  } catch (err) {
    console.error('m1 acceptJob error:', err);
    fail(res, 500, 'Could not accept the job');
  }
};

// @route POST /api/m1/engineer/jobs/:id/decline — hide an offered job.
exports.declineJob = async (req, res) => {
  try {
    const b = await M1Booking.findOne({ where: { id: req.params.id, status: 'requested' }, include: [{ model: M1Service, as: 'service', attributes: ['price'] }] });
    if (!b) return fail(res, 404, 'Job not found');
    b.declinedBy = [...new Set([...(b.declinedBy || []), req.m1User.id])];
    // The engineer the customer picked said no: open it to everyone nearby,
    // at the standard price, so the customer isn't left waiting.
    const oemIds = await oemHelp.oemIdsForPhone(req.m1User.phone);
    if (b.requestedEngineerId === req.m1User.id || oemIds.includes(b.oemEngineerId)) {
      b.requestedEngineerId = null;
      b.oemEngineerId = null;
      if (b.service) b.visitCharge = b.service.price;
      stamp(b, 'requested', `${req.m1User.name || 'The engineer'} is not available. Finding another engineer nearby`);
      await notifyCustomer(b, 'released', 'Finding another engineer 🔄', `${req.m1User.name || 'The engineer'} isn't available. We're finding another engineer near you.`);
    }
    await b.save();
    res.json({ success: true });
  } catch (err) {
    console.error('m1 declineJob error:', err);
    fail(res, 500, 'Could not decline');
  }
};

// @route GET /api/m1/engineer/busy — my booked start hours, per date.
exports.myBusy = async (req, res) => {
  try {
    res.json({ success: true, data: await busySlots(req.m1User.id, today(), null, await oemHelp.oemIdsForPhone(req.m1User.phone)) });
  } catch (err) {
    console.error('m1 myBusy error:', err);
    fail(res, 500, 'Could not load your schedule');
  }
};

// @route POST /api/m1/engineer/jobs/:id/reschedule  { date, slot, reason }
// Ask the customer to move an accepted visit (e.g. an earlier job ran late).
// The booking keeps its time until the customer accepts.
exports.requestReschedule = async (req, res) => {
  try {
    const b = await loadJob(req, res); if (!b) return;
    if (b.engineerId !== req.m1User.id) return fail(res, 404, 'Job not found');
    if (!['accepted', 'on_the_way'].includes(b.status)) return fail(res, 400, 'Only a job that has not started can be rescheduled');
    if (b.rescheduleRequest?.status === 'pending') return fail(res, 400, 'You already asked to reschedule. Wait for the customer to answer');
    const date = String(req.body?.date || '');
    const slot = String(req.body?.slot || '');
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today()) return fail(res, 400, 'Choose a date from today onwards');
    if (!SLOTS.includes(slot)) return fail(res, 400, 'Choose a time');
    if (date === today() && Number(slot.slice(0, 2)) <= nowHourIST()) return fail(res, 400, 'That time has already passed today');
    if (date === b.scheduledDate && slot === slotStart(b.slot)) return fail(res, 400, 'Choose a time different from the current one');
    if (!reason) return fail(res, 400, 'Tell the customer why you need to reschedule');
    const busy = await busySlots(req.m1User.id, date, b.id);
    if ((busy[date] || []).includes(slot)) return fail(res, 409, 'You already have a job at that time');
    b.rescheduleRequest = { fromDate: b.scheduledDate, fromSlot: b.slot, date, slot, reason, status: 'pending', at: new Date().toISOString() };
    stamp(b, b.status, `Engineer asked to move the visit to ${whenLabel(date, slot)}: ${reason}`);
    await notifyCustomer(b, 'reschedule', 'Reschedule request ⏰', `${req.m1User.name} asks to move your visit to ${whenLabel(date, slot)}. Tap to accept or keep the original time.`);
    await b.save();
    res.json({ success: true, data: bookingJson(b, 'engineer', req.m1User.id) });
  } catch (err) {
    console.error('m1 requestReschedule error:', err);
    fail(res, 500, 'Could not send the reschedule request');
  }
};

// @route POST /api/m1/engineer/jobs/:id/status  { action: on_the_way | start | complete | release, otp, finalAmount, partsUsed, workNotes }
exports.updateJob = async (req, res) => {
  try {
    const b = await loadJob(req, res); if (!b) return;
    if (b.engineerId !== req.m1User.id) return fail(res, 404, 'Job not found');
    const { action } = req.body || {};
    if (action === 'on_the_way') {
      if (b.status !== 'accepted') return fail(res, 400, 'Job already started');
      b.status = 'on_the_way'; stamp(b, 'on_the_way');
      await notifyCustomer(b, 'on_the_way', 'Engineer on the way 🚗', `${req.m1User.name} is heading to you for your ${serviceName(b)}.`);
    } else if (action === 'arrived') {
      // "I've reached the spot": the customer's tracker moves to Reached.
      if (!['accepted', 'on_the_way'].includes(b.status)) return fail(res, 400, "You can't mark this job as reached now");
      if (b.arrivedAt) return fail(res, 400, 'Already marked as reached');
      if (b.status === 'accepted') b.status = 'on_the_way';
      b.arrivedAt = new Date();
      stamp(b, 'on_the_way', 'Engineer reached the spot');
      await notifyCustomer(b, 'arrived', 'Engineer has arrived 📍', `${req.m1User.name} reached your place. Share your OTP ${b.startOtp} to start the work.`);
    } else if (action === 'start') {
      if (!['accepted', 'on_the_way'].includes(b.status)) return fail(res, 400, "This job can't be started now");
      if (String(req.body.otp || '').trim() !== b.startOtp) return fail(res, 400, "Incorrect OTP. Ask the customer for the 4-digit code in their app");
      if (!b.arrivedAt) b.arrivedAt = new Date(); // starting on site means they've reached
      b.status = 'in_progress'; stamp(b, 'in_progress');
      await notifyCustomer(b, 'started', 'Work started 🔧', `${req.m1User.name} started work on your ${serviceName(b)}.`);
    } else if (action === 'complete') {
      if (b.status !== 'in_progress') return fail(res, 400, 'Start the job first');
      const parts = (Array.isArray(req.body.partsUsed) ? req.body.partsUsed : [])
        .map((p) => ({ name: String(p.name || '').trim(), qty: Number(p.qty) || 1, price: Number(p.price) || 0 }))
        .filter((p) => p.name);
      const partsTotal = parts.reduce((s, p) => s + p.qty * p.price, 0);
      const labour = Number(req.body.labourCharge) || 0;
      if (labour < 0) return fail(res, 400, 'Enter a valid service charge');
      // Proof of work: at least one after-work photo, and what was done.
      const workPhotos = (Array.isArray(req.body.workPhotos) ? req.body.workPhotos : [])
        .filter((p) => WORK_PHOTO_PATH.test(String(p)) && fs.existsSync(path.join(WORK_DIR, path.basename(p)))).slice(0, 6);
      if (!workPhotos.length) return fail(res, 400, 'Take at least one photo of the finished work');
      const notes = String(req.body.workNotes || '').trim();
      if (notes.length < 5) return fail(res, 400, 'Write what you found and fixed (a few words at least)');
      b.partsUsed = parts;
      b.workNotes = notes;
      b.workPhotos = workPhotos;
      b.finalAmount = Math.round((Number(b.visitCharge) + labour + partsTotal) * 100) / 100;
      b.status = 'completed'; stamp(b, 'completed');
      await notifyCustomer(b, 'completed', 'Work done 🎉', `Your ${serviceName(b)} is complete. See the service report and rate ${req.m1User.name}.`);
    } else if (action === 'release') {
      if (!['accepted', 'on_the_way'].includes(b.status)) return fail(res, 400, "This job can't be released now");
      b.declinedBy = [...new Set([...(b.declinedBy || []), req.m1User.id])];
      b.engineerId = null; b.status = 'requested'; b.rescheduleRequest = null; stamp(b, 'requested', 'Engineer released the job; finding another engineer');
      await notifyCustomer(b, 'released', 'Finding another engineer', `${req.m1User.name} can't make it. We're finding another engineer near you.`);
    } else {
      return fail(res, 400, 'Unknown action');
    }
    await b.save();
    res.json({ success: true, data: bookingJson(b, 'engineer') });
  } catch (err) {
    console.error('m1 updateJob error:', err);
    fail(res, 500, 'Could not update the job');
  }
};
