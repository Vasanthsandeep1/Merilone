const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, PartnerProfile, StaffUser, OrgInviteLink } = require('../models');
const { generateCaptcha, verifyCaptcha } = require('../utils/captcha');
const COMPANY_TYPES = require('../config/companyTypes');
const ORGANISATION_TYPES = require('../config/organisationTypes');
const { razorpay } = require('../config/razorpay');
const { sendMail, isMailConfigured } = require('../utils/mailer');
require('dotenv').config();

const STAFF_ROLES = ['sales', 'zonal_manager', 'flsp', 'tender_admin', 'finance', 'head', 'rsm'];
const STAFF_ROLE_LABELS = { sales: 'Sales', zonal_manager: 'Zonal Manager', flsp: 'FLSP', tender_admin: 'Tender Admin', finance: 'Finance', head: 'Head', rsm: 'RSM' };
const DEPARTMENTS = ['Endo', 'Diagno', '360'];
const TENDER_FIELDS = ['GEM', 'Open'];
const INDIA_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

// At least 8 characters, one uppercase, one lowercase, one digit, one
// special character — enforced here (not just in the frontend's checklist),
// since the frontend check alone is trivially bypassable via a direct API call.
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

// +91 followed by a 10-digit Indian mobile number starting 6-9 — matches
// PartnerRegisterPage.tsx's fixed +91 prefix input.
const MOBILE_RULE = /^\+91[6-9]\d{9}$/;

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, userType: user.userType },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '90d' }
  );
};

// Staff (Sales/Zonal Manager/FLSP) tokens deliberately carry the ORG
// OWNER'S user id as `id` — not the StaffUser's own row id — so a staff
// login gets the exact same dashboard/pages/data as the org owner (every
// controller in this app scopes tenders/notes/quotations/etc. off
// `req.user.id` alone, and there's no reasonable way to retrofit every one
// of them into a dual owner/staff identity). The real StaffUser row is
// still reachable via `staffId`, and `staffRole`/`partnerProfileId` mark
// the token as staff-issued for the few places that must stay owner-only
// (see orgStaffRoutes.js's requireOwner) despite sharing the owner's id.
const generateStaffToken = (staffUser, ownerUserId) => {
  return jwt.sign(
    { id: ownerUserId, userType: 'staff', staffId: staffUser.id, staffRole: staffUser.role, partnerProfileId: staffUser.partnerProfileId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '90d' }
  );
};

// @route  GET /api/auth/company-types
// Canonical list for the partner registration form's Step 2 checkboxes.
exports.getCompanyTypes = (_req, res) => {
  res.status(200).json(COMPANY_TYPES);
};

// @route  GET /api/auth/organisation-types
// Canonical list for the partner registration form's Step 1 (Pre-requisites).
exports.getOrganisationTypes = (_req, res) => {
  res.status(200).json(ORGANISATION_TYPES);
};

// @route  GET /api/auth/captcha
// Issues a fresh math-captcha challenge for the partner registration flow.
exports.getCaptcha = (_req, res) => {
  res.status(200).json(generateCaptcha());
};

// @route  POST /api/auth/register-partner
// Public self-service signup for the OEM/Reseller pricing cards — a single
// flow for both (see components/blocks/pricing-section.tsx), distinguished
// by which industry vertical(s) the company selects (companyTypes) and
// which pricing card it started from (partnerType). Called only after the
// registration wizard's payment step has a verified Razorpay subscription
// (see subscriptionController.js) — no subscription, no account.
exports.registerPartner = async (req, res) => {
  try {
    const { name, email, mobile, companyTypes, password, partnerType, organisationType, razorpaySubscriptionId } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: 'Name and email are required' });
    }

    if (!mobile || !MOBILE_RULE.test(mobile)) {
      return res.status(400).json({ message: 'Enter a valid 10-digit mobile number' });
    }

    if (!['oem', 'reseller'].includes(partnerType)) {
      return res.status(400).json({ message: 'partnerType must be oem or reseller' });
    }

    if (!organisationType || !ORGANISATION_TYPES.includes(organisationType)) {
      return res.status(400).json({ message: 'Select a valid business/organisation type' });
    }

    // Values don't have to be from COMPANY_TYPES — the frontend's "Other"
    // field lets a company type in a vertical that isn't in the fixed list
    // at all (see PartnerRegisterPage.tsx), so this only guards against
    // empty/garbage entries, not membership in the canonical list.
    const types = Array.isArray(companyTypes) ? companyTypes.map((t) => String(t).trim()).filter(Boolean) : [];
    if (types.length === 0) {
      return res.status(400).json({ message: 'Select at least one company type, or type your own' });
    }
    const tooLong = types.find((t) => t.length > 100);
    if (tooLong) {
      return res.status(400).json({ message: 'Company type must be under 100 characters' });
    }

    if (!password || !PASSWORD_RULE.test(password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character' });
    }

    if (!razorpaySubscriptionId) {
      return res.status(400).json({ message: 'Complete the registration fee payment first' });
    }
    // A verified checkout signature (checked by /subscription/verify)
    // proves the callback came from Razorpay for a real razorpay_payment_id
    // tied to this subscription — Razorpay only ever fires that callback
    // after the mandate's first authorization payment has actually gone
    // through, so by the time we're here the payment itself is genuine.
    // What lags is Razorpay's own subscription resource: it can take well
    // over the old ~7s budget to flip from 'created' to
    // 'authenticated'/'active' on their side (propagation delay, worse for
    // UPI Autopay), so poll considerably longer before treating a
    // still-'created' read as a real failure rather than eventual
    // consistency. If a user's Checkout window comes back here and it's
    // STILL not flipped after ~45s, the frontend lets them retry this same
    // call (no need to pay again) instead of resubmitting the whole form.
    let subscription;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        subscription = await razorpay.subscriptions.fetch(razorpaySubscriptionId);
      } catch (err) {
        return res.status(400).json({ message: 'Could not verify the registration fee subscription' });
      }
      if (['active', 'authenticated'].includes(subscription.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    if (!['active', 'authenticated'].includes(subscription.status)) {
      return res.status(409).json({
        message: `Your payment is still being confirmed by Razorpay (status: ${subscription.status}) — this can take a minute. Please retry in a moment; you won't be charged again.`,
        retryable: true,
      });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(409).json({ message: 'Email is already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({
      name,
      email,
      mobile,
      password: hashedPassword,
      userType: 'partner',
      partnerType,
      organisationType,
      companyTypes: JSON.stringify(types),
      razorpaySubscriptionId
    });

    res.status(201).json({ message: 'Account created — you can now sign in.' });
  } catch (error) {
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
};

// @route  POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ where: { email } });
    if (user) {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      const token = generateToken(user);

      return res.status(200).json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          mobile: user.mobile,
          userType: user.userType,
          partnerType: user.partnerType,
          organisationType: user.organisationType,
          companyTypes: user.companyTypes ? JSON.parse(user.companyTypes) : null,
          profileSubmitted: user.profileSubmitted,
          photoUrl: null
        }
      });
    }

    // Not a partner-org account — check whether it's a staff login instead.
    const staffUser = await StaffUser.findOne({ where: { email } });
    if (!staffUser) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const staffMatch = await bcrypt.compare(password, staffUser.password);
    if (!staffMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (staffUser.status === 'pending') {
      return res.status(403).json({ message: 'Your registration is pending approval from your organization admin.' });
    }
    if (staffUser.status === 'rejected') {
      return res.status(403).json({ message: 'Your registration was not approved by your organization admin. Contact them for details.' });
    }
    if (staffUser.status === 'inactive') {
      return res.status(403).json({ message: 'Your account has been deactivated by your organization admin.' });
    }

    // The org's own User (its owner) is who every shared piece of data in
    // this app is actually scoped to — resolve it so the staff token can
    // carry that id and get the exact same dashboard/data the owner sees.
    const profile = await PartnerProfile.findByPk(staffUser.partnerProfileId, { include: [{ model: User, as: 'user' }] });
    if (!profile?.user) {
      return res.status(500).json({ message: 'Your organization account could not be found — contact support.' });
    }
    const owner = profile.user;

    const staffToken = generateStaffToken(staffUser, owner.id);
    res.status(200).json({
      message: 'Login successful',
      token: staffToken,
      user: {
        id: owner.id,
        // Own name for display ("logged in as X"), not the org's — nothing
        // else about the account (partnerType/profileSubmitted/etc.) reads
        // from `name`, so this doesn't affect routing or data scoping.
        name: staffUser.name,
        email: staffUser.email,
        mobile: owner.mobile,
        userType: 'staff',
        partnerType: owner.partnerType,
        organisationType: owner.organisationType,
        companyTypes: owner.companyTypes ? JSON.parse(owner.companyTypes) : null,
        profileSubmitted: owner.profileSubmitted,
        staffId: staffUser.id,
        role: staffUser.role,
        partnerProfileId: staffUser.partnerProfileId,
        departments: staffUser.departments,
        tenderFields: staffUser.tenderFields,
        statesCovered: staffUser.statesCovered,
        photoUrl: null
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
};

// @route  GET /api/auth/me
// @route  PATCH /api/auth/company-types
// Lets a partner add/remove business categories after registration (Setup
// Profile > Company Information). Validated against the same canonical
// list as signup so this can't smuggle in an arbitrary string either.
exports.updateCompanyTypes = async (req, res) => {
  try {
    const { companyTypes } = req.body;
    const types = Array.isArray(companyTypes) ? companyTypes.map((t) => String(t).trim()).filter(Boolean) : [];
    const invalid = types.filter((t) => !COMPANY_TYPES.includes(t));
    if (invalid.length > 0) {
      return res.status(400).json({ message: `Invalid categories: ${invalid.join(', ')}` });
    }
    if (types.length === 0) {
      return res.status(400).json({ message: 'Select at least one business category.' });
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.companyTypes = JSON.stringify(types);
    await user.save();
    res.status(200).json({ companyTypes: types });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update business categories', error: error.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    // Staff tokens' `id` is the ORG OWNER'S user id (see generateStaffToken)
    // — the actual StaffUser row lives at `staffId`. Both are fetched and
    // merged the same way `login`'s staff branch builds its response, so a
    // page refresh (this backs AuthContext's refreshUser) doesn't change
    // what the logged-in user looks like.
    if (req.user.userType === 'staff') {
      const [owner, staffUser] = await Promise.all([
        User.findByPk(req.user.id, { attributes: { exclude: ['password'] } }),
        StaffUser.findByPk(req.user.staffId, { attributes: { exclude: ['password'] } }),
      ]);
      if (!owner || !staffUser) return res.status(404).json({ message: 'User not found' });
      return res.status(200).json({
        id: owner.id,
        name: staffUser.name,
        email: staffUser.email,
        mobile: owner.mobile,
        userType: 'staff',
        partnerType: owner.partnerType,
        organisationType: owner.organisationType,
        companyTypes: owner.companyTypes ? JSON.parse(owner.companyTypes) : null,
        profileSubmitted: owner.profileSubmitted,
        staffId: staffUser.id,
        role: staffUser.role,
        partnerProfileId: staffUser.partnerProfileId,
        departments: staffUser.departments,
        tenderFields: staffUser.tenderFields,
        statesCovered: staffUser.statesCovered,
        photoUrl: null,
      });
    }

    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const json = user.toJSON();
    res.status(200).json({ ...json, companyTypes: json.companyTypes ? JSON.parse(json.companyTypes) : null, photoUrl: null });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch profile', error: error.message });
  }
};

// A PartnerProfile's own User is its organization's implicit admin — every
// org-scoped feature (staff registration notifications, invite links, the
// User Management screen) resolves the org this way, never a separate
// "admin" table.
async function getOrgAdminEmail(partnerProfileId) {
  const profile = await PartnerProfile.findByPk(partnerProfileId, { include: [{ model: User, as: 'user', attributes: ['email', 'name'] }] });
  return profile?.user || null;
}

function orgDisplayName(profile) {
  const info = profile.companyInfo || {};
  return info.tradeName || info.legalName || info.shortName || `Organization #${profile.id}`;
}

// @route  GET /api/auth/organizations/search?q=
// Public — powers the staff registration form's "search your organization"
// step. Returns only what's needed to pick the right one (name), nothing
// from the profile itself. No/short `q` returns a default browsable list
// (alphabetical, capped) instead of nothing, so the picker always shows
// something to scroll through even before the registrant starts typing.
exports.searchOrganizations = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();

    const profiles = await PartnerProfile.findAll({ attributes: ['id', 'companyInfo'] });
    let matches = profiles.map((p) => ({ partnerProfileId: p.id, name: orgDisplayName(p) }));
    matches = q.length >= 2 ? matches.filter((p) => p.name.toLowerCase().includes(q)) : matches;
    matches = matches.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);

    res.status(200).json(matches);
  } catch (error) {
    res.status(500).json({ message: 'Search failed', error: error.message });
  }
};

// @route  GET /api/auth/invite/:code
// Public — resolves a staff invite link/code to its organization's display
// name, so the registration page can show "Registering under: <Org>" and
// lock the org-selector instead of making the person search for it.
exports.resolveInviteCode = async (req, res) => {
  try {
    const invite = await OrgInviteLink.findOne({ where: { code: req.params.code } });
    if (!invite) return res.status(404).json({ message: 'Invalid or expired invite link' });

    const profile = await PartnerProfile.findByPk(invite.partnerProfileId, { attributes: ['id', 'companyInfo'] });
    if (!profile) return res.status(404).json({ message: 'Invalid or expired invite link' });

    res.status(200).json({ partnerProfileId: profile.id, name: orgDisplayName(profile) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to resolve invite link', error: error.message });
  }
};

// @route  POST /api/auth/register-staff
// Public self-service signup for Sales / Zonal Manager / FLSP staff under an
// existing OEM/Reseller organization — creates a `pending` StaffUser (no
// token issued; they can't log in until the org admin approves, see
// orgStaffController.approveStaff) and emails the org admin. Mirrors OLD's
// Register.jsx conditional scope fields: only Sales/Zonal Manager collect
// department/tenderField/statesCovered — FLSP registers with just the
// baseline fields.
exports.registerStaff = async (req, res) => {
  try {
    const { name, email, password, role, partnerProfileId, inviteCode, departments = [], tenderFields = [], statesCovered = [] } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: 'Name and email are required' });
    }
    if (!STAFF_ROLES.includes(role)) {
      return res.status(400).json({ message: `Role must be one of: ${STAFF_ROLES.map((r) => STAFF_ROLE_LABELS[r]).join(', ')}` });
    }
    if (!password || !PASSWORD_RULE.test(password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character' });
    }

    let profile = null;
    let invitedViaCode = null;
    if (inviteCode) {
      const invite = await OrgInviteLink.findOne({ where: { code: inviteCode } });
      if (!invite) return res.status(400).json({ message: 'Invalid or expired invite link' });
      profile = await PartnerProfile.findByPk(invite.partnerProfileId);
      invitedViaCode = inviteCode;
    } else if (partnerProfileId) {
      profile = await PartnerProfile.findByPk(partnerProfileId);
    }
    if (!profile) {
      return res.status(400).json({ message: 'Select the organization you are registering under' });
    }

    // All three staff roles collect department/tender-field/states scope
    // (FLSP included) — this originally matched OLD's Sales/Zonal-Head-only
    // split, widened per a later request to cover FLSP too.
    const isScopedRole = role === 'sales' || role === 'zonal_manager' || role === 'flsp' || role === 'rsm';
    const deptList = Array.isArray(departments) ? departments.filter((d) => DEPARTMENTS.includes(d)) : [];
    const fieldList = Array.isArray(tenderFields) ? tenderFields.filter((f) => TENDER_FIELDS.includes(f)) : [];
    const stateList = Array.isArray(statesCovered) ? statesCovered.filter((s) => INDIA_STATES.includes(s)) : [];
    if (isScopedRole) {
      if (!deptList.length) return res.status(400).json({ message: 'Select at least one department you cover' });
      if (!fieldList.length) return res.status(400).json({ message: 'Select at least one tender field you cover' });
      if (!stateList.length) return res.status(400).json({ message: 'Select at least one state you cover' });
    }

    const existingUser = await User.findOne({ where: { email } });
    const existingStaff = await StaffUser.findOne({ where: { email } });
    if (existingUser || existingStaff) {
      return res.status(409).json({ message: 'Email is already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await StaffUser.create({
      name,
      email,
      password: hashedPassword,
      role,
      partnerProfileId: profile.id,
      departments: isScopedRole ? deptList : null,
      tenderFields: isScopedRole ? fieldList : null,
      statesCovered: isScopedRole ? stateList : null,
      status: 'pending',
      invitedViaCode,
    });

    if (isMailConfigured()) {
      const admin = await getOrgAdminEmail(profile.id);
      if (admin?.email) {
        sendMail({
          to: admin.email,
          subject: `New ${STAFF_ROLE_LABELS[role]} registration pending your approval`,
          text: `${name} (${email}) has registered as ${STAFF_ROLE_LABELS[role]} under your organization and is waiting for your approval. Log in and open User Management to review and approve or reject this request.`,
        }).catch((err) => console.error('registerStaff: failed to email org admin —', err.message));
      }
    }

    res.status(201).json({ message: 'Registration submitted — your organization admin has been notified and will review your request shortly.' });
  } catch (error) {
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
};

// @route PATCH /api/auth/password   { currentPassword, newPassword }
// Self-service "change my own password" for the currently logged-in login —
// the org owner (User) or a staff login (StaffUser) — as opposed to
// orgStaffController.resetStaffPassword, which is the owner setting a
// DIFFERENT staff member's password and doesn't need the current one.
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (!PASSWORD_RULE.test(newPassword)) {
      return res.status(400).json({ message: 'New password must be at least 8 characters with an uppercase letter, a lowercase letter, a digit and a special character.' });
    }

    const isStaff = req.user.userType === 'staff';
    const account = isStaff ? await StaffUser.findByPk(req.user.staffId) : await User.findByPk(req.user.id);
    if (!account) return res.status(404).json({ message: 'Account not found' });

    const ok = await bcrypt.compare(currentPassword, account.password);
    if (!ok) return res.status(401).json({ message: 'Current password is incorrect' });

    account.password = await bcrypt.hash(newPassword, 10);
    await account.save();
    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to change password', error: error.message });
  }
};
