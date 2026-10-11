const { Op, QueryTypes } = require('sequelize');
const { sequelize, M1Booking, M1User, M1Service, M1Category, ServiceEngineer } = require('../models');

// Service Management > Service Requests — every service request customers
// raise in the Meril One app (m1_bookings), for the portal team to follow.
// "Meril product" = the equipment's brand is Meril (as the customer entered
// it, or as it came from their B2G purchase).
//
// "Mine" (scope=mine) = requests from Meril One customers who belong to the
// logged-in B2G user: a client in their client book (linked at sign-up, or
// the same mobile as the client / one of its contact persons), or the user
// themself (same mobile as their portal account).

// Last 10 digits. COLLATE: the m1_* tables and the older B2G tables use
// different collations, and MySQL won't compare across them without it.
const D10 = (col) => `(RIGHT(REGEXP_REPLACE(IFNULL(${col}, ''), '[^0-9]', ''), 10) COLLATE utf8mb4_unicode_ci)`;

// Meril One customer ids that belong to this B2G user.
async function myCustomerIds(userId) {
  const rows = await sequelize.query(
    `SELECT DISTINCT u.id FROM m1_users u
      WHERE u.role = 'customer' AND (
        u.b2g_user_id = :userId
        OR u.b2g_client_id IN (SELECT id FROM clients WHERE user_id = :userId)
        OR u.phone IN (SELECT ${D10('c.phone')} FROM clients c WHERE c.user_id = :userId AND c.phone IS NOT NULL)
        OR u.phone IN (SELECT ${D10('pc.mobile')} FROM clients c JOIN client_contact_links l ON l.client_id = c.id JOIN partner_contacts pc ON pc.id = l.partner_contact_id WHERE c.user_id = :userId)
        OR u.phone IN (SELECT ${D10('pc.alt_mobile')} FROM clients c JOIN client_contact_links l ON l.client_id = c.id JOIN partner_contacts pc ON pc.id = l.partner_contact_id WHERE c.user_id = :userId)
        OR u.phone IN (SELECT ${D10('pc.whatsapp')} FROM clients c JOIN client_contact_links l ON l.client_id = c.id JOIN partner_contacts pc ON pc.id = l.partner_contact_id WHERE c.user_id = :userId)
        OR u.phone = (SELECT ${D10('mobile')} FROM users WHERE id = :userId)
      )`,
    { replacements: { userId }, type: QueryTypes.SELECT },
  );
  return rows.map((r) => r.id);
}

const isMeril = (b) => /meril/i.test(b.equipment?.brand || '');
const ratingOf = (u) => (u?.ratingCount ? Math.round((u.ratingSum / u.ratingCount) * 10) / 10 : null);

function toRow(b) {
  const j = b.toJSON();
  const at = (s) => (j.timeline || []).filter((t) => t.status === s).at(-1)?.at || null;
  const eng = j.engineer || j.requestedEngineer || (j.oemEngineer ? { ...j.oemEngineer, companyName: `Your engineer · ${j.oemEngineer.empId}` } : null);
  return {
    id: j.id,
    bookingNo: j.bookingNo,
    raisedAt: j.createdAt,
    status: j.status,
    meril: isMeril(j),
    customer: j.customer ? {
      name: j.contactName || j.customer.name, orgName: j.customer.orgName, phone: j.contactPhone || j.customer.phone,
      segment: j.customer.segment, b2gLinked: !!(j.customer.b2gClientId || j.customer.b2gUserId),
    } : null,
    address: j.address, city: j.city, pincode: j.pincode,
    equipment: j.equipment || null,
    service: j.service ? { name: Array.isArray(j.services) && j.services.length > 1 ? j.services.map((s) => s.name).join(' + ') : j.service.name }
      : { name: j.category ? `${j.category.name} service request` : 'Service request' },
    category: j.category ? { name: j.category.name, color: j.category.color } : null,
    issue: j.issue,
    scheduledDate: j.scheduledDate, slot: j.slot,
    engineer: eng ? {
      name: eng.name, phone: eng.phone, companyName: eng.companyName, rating: ratingOf(eng),
      pending: !j.engineer, // picked by the customer, not yet accepted
    } : null,
    visitCharge: Number(j.visitCharge), finalAmount: j.finalAmount != null ? Number(j.finalAmount) : null,
    partsUsed: j.partsUsed || [], workNotes: j.workNotes,
    rating: j.rating, review: j.review, cancelReason: j.cancelReason,
    arrivedAt: j.arrivedAt, completedAt: at('completed'),
    rescheduleRequest: j.rescheduleRequest || null,
    photos: Array.isArray(j.photos) ? j.photos : [],
    timeline: j.timeline || [],
  };
}

// @route GET /api/service-requests?scope=mine|all&search=&status=&category=&meril=1&from=&to=
exports.list = async (req, res) => {
  try {
    const { search = '', status = '', category = '', meril = '', from = '', to = '', scope = 'mine' } = req.query;
    const mineIds = await myCustomerIds(req.user.id);
    const where = {};
    // Mine also = requests on products this user is the OEM / seller of.
    if (scope !== 'all') where[Op.or] = [{ customerId: mineIds }, { oemUserId: req.user.id }];
    if (['requested', 'accepted', 'on_the_way', 'in_progress', 'completed', 'cancelled'].includes(status)) where.status = status;
    if (category) where.categoryId = Number(category) || 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) where.createdAt = { ...(where.createdAt || {}), [Op.gte]: new Date(`${from}T00:00:00+05:30`) };
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) where.createdAt = { ...(where.createdAt || {}), [Op.lte]: new Date(`${to}T23:59:59+05:30`) };

    const rows = await M1Booking.findAll({
      where,
      include: [
        { model: M1Service, as: 'service', attributes: ['name'] },
        { model: M1Category, as: 'category', attributes: ['id', 'name', 'color'] },
        { model: M1User, as: 'customer', attributes: ['name', 'orgName', 'phone', 'segment', 'b2gClientId', 'b2gUserId'] },
        { model: M1User, as: 'engineer', attributes: ['name', 'phone', 'companyName', 'ratingSum', 'ratingCount'] },
        { model: M1User, as: 'requestedEngineer', attributes: ['name', 'phone', 'companyName', 'ratingSum', 'ratingCount'] },
        { model: ServiceEngineer, as: 'oemEngineer', attributes: ['name', 'phone', 'empId'] },
      ],
      order: [['createdAt', 'DESC']],
    });

    let data = rows.map(toRow);
    // Stats before the Meril / search filters, so the tabs can show counts.
    const merilCount = data.filter((r) => r.meril).length;
    if (meril === '1') data = data.filter((r) => r.meril);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      data = data.filter((r) => [r.bookingNo, r.customer?.name, r.customer?.orgName, r.customer?.phone, r.city, r.pincode,
        r.equipment?.brand, r.equipment?.model, r.equipment?.serialNo, r.service?.name, r.engineer?.name]
        .some((v) => String(v || '').toLowerCase().includes(s)));
    }

    const count = (st) => data.filter((r) => st.includes(r.status)).length;
    const done = data.filter((r) => r.status === 'completed');
    const rated = done.filter((r) => r.rating);
    res.json({
      success: true,
      data,
      stats: {
        total: data.length,
        open: count(['requested']),
        ongoing: count(['accepted', 'on_the_way', 'in_progress']),
        completed: done.length,
        cancelled: count(['cancelled']),
        billed: Math.round(done.reduce((s, r) => s + (r.finalAmount || 0), 0) * 100) / 100,
        avgRating: rated.length ? Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) / 10 : null,
      },
      tabs: {
        mine: await M1Booking.count({ where: { [Op.or]: [{ customerId: mineIds }, { oemUserId: req.user.id }] } }),
        all: await M1Booking.count(),
        meril: merilCount,
      },
      categories: await M1Category.findAll({ attributes: ['id', 'name'], order: [['sortOrder', 'ASC']], raw: true }),
    });
  } catch (err) {
    console.error('service requests list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load service requests' });
  }
};
