const { Op, QueryTypes } = require('sequelize');
const { sequelize, ResellerCandidate, ResellerCandidateContract, ResellerSelection, PartnerProfile, User, DealerAuthRequest } = require('../models');
const { ZONE_STATES, ZONE_LIST } = require('../config/indiaZones');
const { sendMail, isMailConfigured } = require('../utils/mailer');

const companyLabel = (profile) => {
  const info = profile?.companyInfo || {};
  return info.tradeName || info.legalName || info.shortName || null;
};

// Dealer Management > Best Reseller Selection — an OEM picks a product
// category and a zone (or a specific state), and sees the top 5 reseller
// candidates ranked by rating then contract track record, matches the
// boss's brief exactly: "based on the ratings and number of contracts the
// particular top 5 resellers should list down for that oem." From there the
// OEM can open a candidate's full profile (with contract history) and
// select them.

// @route GET /api/dealers/reseller-suggestions/meta
// Filter options for the search form — product categories drawn from the
// candidate pool itself (not the full company_sub_categories master list),
// so the dropdown never offers a category with zero matching resellers.
exports.getMeta = async (req, res) => {
  try {
    const candidates = await ResellerCandidate.findAll({ attributes: ['productCategories'], raw: true });
    const categorySet = new Set();
    for (const c of candidates) {
      for (const cat of c.productCategories || []) categorySet.add(cat);
    }
    res.json({
      success: true,
      data: {
        zones: ZONE_LIST,
        states: Object.values(ZONE_STATES).flat().sort(),
        productCategories: Array.from(categorySet).sort(),
      },
    });
  } catch (err) {
    console.error('getMeta error:', err);
    res.status(500).json({ success: false, message: 'Failed to load filters' });
  }
};

// @route GET /api/dealers/reseller-suggestions?productCategory=&zone=&state=
exports.getTopResellers = async (req, res) => {
  try {
    const { productCategory, zone, state } = req.query;
    const where = { status: 'Active' };

    if (state) {
      where.state = state;
    } else if (zone && ZONE_STATES[zone]) {
      where.state = { [Op.in]: ZONE_STATES[zone] };
    }

    const candidates = await ResellerCandidate.findAll({ where, raw: true });

    const filtered = productCategory
      ? candidates.filter((c) => (c.productCategories || []).includes(productCategory))
      : candidates;

    const ranked = filtered
      .sort((a, b) => (Number(b.rating) - Number(a.rating)) || (b.contractsCount - a.contractsCount))
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        companyName: c.companyName,
        city: c.city,
        state: c.state,
        zone: c.zone,
        rating: Number(c.rating),
        contractsCount: c.contractsCount,
        totalContractValue: Number(c.totalContractValue),
        yearsInBusiness: c.yearsInBusiness,
        productCategories: c.productCategories || [],
      }));

    res.json({ success: true, data: ranked, matchCount: filtered.length });
  } catch (err) {
    console.error('getTopResellers error:', err);
    res.status(500).json({ success: false, message: 'Failed to find resellers' });
  }
};

// @route GET /api/dealers/reseller-suggestions/:id
exports.getResellerProfile = async (req, res) => {
  try {
    const candidate = await ResellerCandidate.findByPk(req.params.id, {
      include: [{ model: ResellerCandidateContract, as: 'contracts', order: [['contractDate', 'DESC']] }],
    });
    if (!candidate) return res.status(404).json({ success: false, message: 'Reseller not found' });

    const data = candidate.toJSON();
    res.json({
      success: true,
      data: {
        ...data,
        contracts: (data.contracts || []).sort((a, b) => new Date(b.contractDate) - new Date(a.contractDate)),
      },
    });
  } catch (err) {
    console.error('getResellerProfile error:', err);
    res.status(500).json({ success: false, message: 'Failed to load reseller profile' });
  }
};

// @route POST /api/dealers/reseller-suggestions/:id/invite
// Replaces the old "Select" action — instead of just noting a choice down,
// this emails the reseller candidate directly, inviting them to collaborate
// on supplying this OEM's product in the given zone/state (see boss's
// brief). The invite is still recorded in reseller_selections either way,
// so "Your Invited Resellers" stays accurate even if the email itself
// fails to send (e.g. SMTP not configured in this environment).
exports.inviteReseller = async (req, res) => {
  try {
    const candidate = await ResellerCandidate.findByPk(req.params.id);
    if (!candidate) return res.status(404).json({ success: false, message: 'Reseller not found' });

    const { productCategory, zone, state, note } = req.body || {};
    const selection = await ResellerSelection.create({
      userId: req.user.id, resellerCandidateId: candidate.id, productCategory, zone, state, note,
    });

    let emailSent = false;
    let emailError = null;
    if (candidate.email && isMailConfigured()) {
      try {
        const oemProfile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
        const oemName = companyLabel(oemProfile) || req.user.name || 'A Meril One OEM';
        const scopeLine = [productCategory, state || zone].filter(Boolean).join(' — ');
        const registerUrl = `${process.env.FRONTEND_URL || 'https://localhost:5173'}/register?type=reseller`;

        await sendMail({
          to: candidate.email,
          subject: `Invitation to become ${oemName}'s reseller${scopeLine ? ` (${scopeLine})` : ''}`,
          text: `Hello ${candidate.contactPerson || candidate.companyName},\n\n`
            + `${oemName} would like to invite ${candidate.companyName} to collaborate as their reseller`
            + `${productCategory ? ` for ${productCategory}` : ''}${state ? ` in ${state}` : zone ? ` in the ${zone} zone` : ''}.\n\n`
            + `${note ? `Message from ${oemName}:\n${note}\n\n` : ''}`
            + `To accept this invitation, please register or sign in on Meril One: ${registerUrl}\n\n`
            + `— ${oemName}, via Meril One`,
          html: `<p>Hello ${candidate.contactPerson || candidate.companyName},</p>`
            + `<p><strong>${oemName}</strong> would like to invite <strong>${candidate.companyName}</strong> to collaborate as their reseller`
            + `${productCategory ? ` for <strong>${productCategory}</strong>` : ''}${state ? ` in <strong>${state}</strong>` : zone ? ` in the <strong>${zone}</strong> zone` : ''}.</p>`
            + `${note ? `<p><em>Message from ${oemName}:</em><br/>${note.replace(/\n/g, '<br/>')}</p>` : ''}`
            + `<p><a href="${registerUrl}">Accept — sign up on Meril One</a></p>`
            + `<p>— ${oemName}, via Meril One</p>`,
        });
        emailSent = true;
      } catch (mailErr) {
        console.error('inviteReseller mail error:', mailErr.message);
        emailError = mailErr.message;
      }
    }

    res.status(201).json({ success: true, data: selection.toJSON(), emailSent, emailError });
  } catch (err) {
    console.error('inviteReseller error:', err);
    res.status(500).json({ success: false, message: 'Failed to invite reseller' });
  }
};

// @route POST /api/dealers/reseller-suggestions/authorized/:requestId/invite
// Same "invite to collaborate" email as inviteReseller above, but for a
// real reseller this OEM already has a Request Authorization relationship
// with (not a sample directory row) — lets the OEM re-engage them for a
// new zone/product from right inside their profile view. Only ever the
// OEM the original request was addressed to may do this (same guard as
// dealerAuthRequestController.getResellerProfile). Not persisted to
// reseller_selections (that table is keyed to a candidate row, which a
// real reseller doesn't have) — the email itself is the record.
exports.inviteAuthorizedReseller = async (req, res) => {
  try {
    const request = await DealerAuthRequest.findOne({ where: { id: req.params.requestId } });
    if (!request) return res.status(404).json({ success: false, message: 'Reseller relationship not found' });
    if (request.toUserId !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized' });

    const fromUser = await User.findByPk(request.fromUserId, { attributes: ['id', 'name', 'email'] });
    if (!fromUser) return res.status(404).json({ success: false, message: 'Reseller account not found' });
    const fromProfile = await PartnerProfile.findOne({ where: { userId: fromUser.id } });
    const resellerName = companyLabel(fromProfile) || fromUser.name;

    const { productCategory, zone, state, note } = req.body || {};
    let emailSent = false;
    let emailError = null;
    if (isMailConfigured()) {
      try {
        const oemProfile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
        const oemName = companyLabel(oemProfile) || req.user.name || 'A Meril One OEM';
        const scopeLine = [productCategory, state || zone].filter(Boolean).join(' — ');

        await sendMail({
          to: fromUser.email,
          subject: `${oemName} would like to collaborate with you${scopeLine ? ` (${scopeLine})` : ''}`,
          text: `Hello ${resellerName},\n\n`
            + `${oemName} would like to continue working with you as their reseller`
            + `${productCategory ? ` for ${productCategory}` : ''}${state ? ` in ${state}` : zone ? ` in the ${zone} zone` : ''}.\n\n`
            + `${note ? `Message from ${oemName}:\n${note}\n\n` : ''}`
            + `Log in to Meril One to view the details.\n\n— ${oemName}, via Meril One`,
          html: `<p>Hello ${resellerName},</p>`
            + `<p><strong>${oemName}</strong> would like to continue working with you as their reseller`
            + `${productCategory ? ` for <strong>${productCategory}</strong>` : ''}${state ? ` in <strong>${state}</strong>` : zone ? ` in the <strong>${zone}</strong> zone` : ''}.</p>`
            + `${note ? `<p><em>Message from ${oemName}:</em><br/>${note.replace(/\n/g, '<br/>')}</p>` : ''}`
            + `<p>Log in to Meril One to view the details.</p><p>— ${oemName}, via Meril One</p>`,
        });
        emailSent = true;
      } catch (mailErr) {
        console.error('inviteAuthorizedReseller mail error:', mailErr.message);
        emailError = mailErr.message;
      }
    }

    res.json({ success: true, emailSent, emailError });
  } catch (err) {
    console.error('inviteAuthorizedReseller error:', err);
    res.status(500).json({ success: false, message: 'Failed to invite reseller' });
  }
};

// @route GET /api/dealers/reseller-suggestions/search?q=
// Unified search: matches both the sample candidate directory AND any real
// resellers who already have an authorization relationship with this OEM
// (a DealerAuthRequest they sent in) — see boss's brief: "if i search the
// reseller who is already be in touch or had a deal an authorization should
// also be listed there." An empty q returns everything (capped), so this
// also works as a general "browse resellers" view.
exports.searchResellers = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();

    const candidateWhere = q ? { companyName: { [Op.like]: `%${q}%` } } : {};
    const candidates = await ResellerCandidate.findAll({ where: candidateWhere, order: [['rating', 'DESC']], limit: 100 });

    const candidateIds = candidates.map((c) => c.id);
    const selections = candidateIds.length
      ? await ResellerSelection.findAll({ where: { userId: req.user.id, resellerCandidateId: candidateIds }, order: [['createdAt', 'DESC']] })
      : [];
    const inviteStatusByCandidate = new Map();
    for (const s of selections) if (!inviteStatusByCandidate.has(s.resellerCandidateId)) inviteStatusByCandidate.set(s.resellerCandidateId, s.createdAt);

    const candidateResults = candidates.map((c) => ({
      source: 'candidate',
      id: c.id,
      companyName: c.companyName,
      city: c.city,
      state: c.state,
      zone: c.zone,
      rating: Number(c.rating),
      contractsCount: c.contractsCount,
      totalContractValue: Number(c.totalContractValue),
      productCategories: c.productCategories || [],
      invited: inviteStatusByCandidate.has(c.id),
      invitedAt: inviteStatusByCandidate.get(c.id) || null,
    }));

    // Real resellers who already sent this OEM a Request Authorization —
    // an existing relationship, regardless of the sample candidate pool.
    const authRows = await sequelize.query(
      `SELECT dar.id AS request_id, dar.status AS auth_status, dar.valid_from, dar.valid_to, dar.created_at,
              u.id AS from_user_id, u.name AS user_name, u.email AS user_email, pp.company_info, pp.registered_address
       FROM dealer_auth_requests dar
       JOIN users u ON u.id = dar.from_user_id
       LEFT JOIN partner_profiles pp ON pp.user_id = u.id
       WHERE dar.to_user_id = :oemId
       ORDER BY dar.created_at DESC`,
      { replacements: { oemId: req.user.id }, type: QueryTypes.SELECT },
    );

    const seenUsers = new Set();
    const authorizedResults = [];
    for (const r of authRows) {
      if (seenUsers.has(r.from_user_id)) continue; // keep only the most recent request per reseller
      seenUsers.add(r.from_user_id);
      const info = typeof r.company_info === 'string' ? JSON.parse(r.company_info || '{}') : (r.company_info || {});
      const address = typeof r.registered_address === 'string' ? JSON.parse(r.registered_address || '{}') : (r.registered_address || {});
      const companyName = info.tradeName || info.legalName || info.shortName || r.user_name;
      if (q && !companyName.toLowerCase().includes(q.toLowerCase())) continue;
      authorizedResults.push({
        source: 'authorized',
        requestId: r.request_id,
        fromUserId: r.from_user_id,
        companyName,
        email: r.user_email,
        state: address.state || null,
        authStatus: r.auth_status,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        requestedAt: r.created_at,
      });
    }

    res.json({ success: true, data: { candidates: candidateResults, authorized: authorizedResults } });
  } catch (err) {
    console.error('searchResellers error:', err);
    res.status(500).json({ success: false, message: 'Failed to search resellers' });
  }
};

// @route GET /api/dealers/reseller-suggestions/selections/mine
exports.listMySelections = async (req, res) => {
  try {
    const selections = await ResellerSelection.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      include: [{ model: ResellerCandidate, as: 'candidate' }],
    });
    res.json({
      success: true,
      data: selections.map((s) => {
        const row = s.toJSON();
        return {
          id: row.id,
          productCategory: row.productCategory,
          zone: row.zone,
          state: row.state,
          note: row.note,
          createdAt: row.createdAt,
          resellerCandidateId: row.resellerCandidateId,
          companyName: row.candidate?.companyName || null,
        };
      }),
    });
  } catch (err) {
    console.error('listMySelections error:', err);
    res.status(500).json({ success: false, message: 'Failed to load your selections' });
  }
};
