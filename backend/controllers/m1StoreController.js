const { Op } = require('sequelize');
const { PartnerDivisionProduct, PartnerProfile, M1QuoteRequest, M1Notification, M1User } = require('../models');

// Meril One Store: the B2G product catalogue (View Profile > Products,
// partner_division_products) listed in the customer app with no prices.
// Customers tap "Get quote"; the product's owner answers it in the portal
// (Service Management > Quote Requests).

const fail = (res, code, message) => res.status(code).json({ success: false, message });
const STATUSES = ['new', 'contacted', 'quoted', 'closed'];

async function sellerNames(userIds) {
  const profiles = userIds.length ? await PartnerProfile.findAll({ where: { userId: userIds }, attributes: ['userId', 'companyInfo'] }) : [];
  return Object.fromEntries(profiles.map((p) => [p.userId, p.companyInfo?.tradeName || p.companyInfo?.legalName || null]));
}

const quoteJson = (q) => ({
  id: q.id, requestNo: q.requestNo, productId: q.productId, productName: q.productName, productCode: q.productCode,
  quantity: q.quantity, message: q.message, status: q.status, reply: q.reply, createdAt: q.createdAt, updatedAt: q.updatedAt,
});

// ---------------- App (customer) ----------------

// @route GET /api/m1/store/products
exports.storeProducts = async (req, res) => {
  try {
    const rows = await PartnerDivisionProduct.findAll({ order: [['category', 'ASC'], ['productName', 'ASC']] });
    const sellers = await sellerNames([...new Set(rows.map((r) => r.userId))]);
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id, name: r.productName, code: r.productCode, category: r.category || 'Other', division: r.division,
        description: r.description, imageUrl: r.imageUrl, brochureUrl: r.brochureUrl, seller: sellers[r.userId] || null,
      })),
    });
  } catch (err) {
    console.error('m1 storeProducts error:', err);
    fail(res, 500, 'Could not load the store');
  }
};

// @route POST /api/m1/quote-requests  { productId, quantity, message }
exports.createQuoteRequest = async (req, res) => {
  try {
    const p = await PartnerDivisionProduct.findByPk(Number(req.body.productId) || 0);
    if (!p) return fail(res, 404, 'This product is no longer in the store');
    const quantity = Math.floor(Number(req.body.quantity));
    if (!(quantity >= 1 && quantity <= 100000)) return fail(res, 400, 'Enter a quantity of 1 or more');
    const message = String(req.body.message || '').trim().slice(0, 2000) || null;
    const q = await M1QuoteRequest.create({
      requestNo: 'TMP', customerId: req.m1User.id, productId: p.id, ownerUserId: p.userId,
      productName: p.productName, productCode: p.productCode, quantity, message,
    });
    q.requestNo = `Q${String(q.id).padStart(6, '0')}`;
    await q.save();
    await M1Notification.create({
      userId: req.m1User.id, kind: 'quote', title: 'Quote requested 🧾',
      body: `We've sent your request for ${quantity} × ${p.productName} (${q.requestNo}). You'll hear back soon.`.slice(0, 500),
    }).catch(() => {});
    res.json({ success: true, data: quoteJson(q) });
  } catch (err) {
    console.error('m1 createQuoteRequest error:', err);
    fail(res, 500, 'Could not send the quote request');
  }
};

// @route GET /api/m1/quote-requests  (mine)
exports.myQuoteRequests = async (req, res) => {
  try {
    const rows = await M1QuoteRequest.findAll({ where: { customerId: req.m1User.id }, order: [['id', 'DESC']] });
    res.json({ success: true, data: rows.map(quoteJson) });
  } catch (err) {
    console.error('m1 myQuoteRequests error:', err);
    fail(res, 500, 'Could not load your quote requests');
  }
};

// ---------------- Portal (B2G) ----------------

// @route GET /api/m1-quotes?status=&q=  (requests for this user's products)
exports.portalList = async (req, res) => {
  try {
    const where = { ownerUserId: req.user.id };
    if (STATUSES.includes(req.query.status)) where.status = req.query.status;
    const s = String(req.query.q || '').trim();
    if (s) where[Op.or] = [{ productName: { [Op.like]: `%${s}%` } }, { requestNo: { [Op.like]: `%${s}%` } }, { productCode: { [Op.like]: `%${s}%` } }];
    const rows = await M1QuoteRequest.findAll({
      where, order: [['id', 'DESC']],
      include: [{ model: M1User, as: 'customer', attributes: ['name', 'phone', 'email', 'orgName', 'address', 'city', 'pincode'] }],
    });
    const all = await M1QuoteRequest.findAll({ where: { ownerUserId: req.user.id }, attributes: ['status'], raw: true });
    const stats = Object.fromEntries(STATUSES.map((k) => [k, all.filter((r) => r.status === k).length]));
    res.json({
      success: true, stats: { total: all.length, ...stats },
      data: rows.map((q) => ({ ...quoteJson(q), customer: q.customer ? q.customer.get({ plain: true }) : null })),
    });
  } catch (err) {
    console.error('m1 quote portalList error:', err);
    fail(res, 500, 'Could not load quote requests');
  }
};

// @route PUT /api/m1-quotes/:id  { status, reply }  (tells the customer in the app)
exports.portalUpdate = async (req, res) => {
  try {
    const q = await M1QuoteRequest.findOne({ where: { id: req.params.id, ownerUserId: req.user.id } });
    if (!q) return fail(res, 404, 'Quote request not found');
    const status = STATUSES.includes(req.body.status) ? req.body.status : q.status;
    const reply = req.body.reply === undefined ? q.reply : (String(req.body.reply || '').trim().slice(0, 2000) || null);
    const changed = status !== q.status || reply !== q.reply;
    await q.update({ status, reply });
    if (changed) {
      const title = {
        new: 'Quote request updated', contacted: "We're working on your quote 📞",
        quoted: 'Your quote is ready 🧾', closed: 'Quote request closed',
      }[status];
      await M1Notification.create({
        userId: q.customerId, kind: 'quote', title,
        body: `${q.productName} (${q.requestNo})${reply ? `: ${reply}` : ''}`.slice(0, 500),
      }).catch(() => {});
    }
    res.json({ success: true, data: quoteJson(q) });
  } catch (err) {
    console.error('m1 quote portalUpdate error:', err);
    fail(res, 500, 'Could not update the quote request');
  }
};
