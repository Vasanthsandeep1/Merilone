const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { PartnerProfile, StaffUser, OrgInviteLink } = require('../models');
const { sendMail, isMailConfigured } = require('../utils/mailer');

// At least 8 characters, one uppercase, one lowercase, one digit, one
// special character — same rule authController.js enforces at registration,
// applied again here since an org admin can also set a staff member's
// password directly.
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const STAFF_ROLE_LABELS = { sales: 'Sales', zonal_manager: 'Zonal Manager', flsp: 'FLSP', tender_admin: 'Tender Admin', finance: 'Finance', head: 'Head', rsm: 'RSM' };

// Every handler here is scoped to req.user's own PartnerProfile — an org
// admin (the User behind a PartnerProfile) can only ever see/act on their
// own organization's staff, never another org's. protect already put
// {id, ...} on req.user; this just resolves which org that partner owns.
async function getOwnProfile(req, res) {
  const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
  if (!profile) {
    res.status(404).json({ success: false, message: 'Complete your organization profile before managing staff.' });
    return null;
  }
  return profile;
}

async function getOwnStaffMember(req, res) {
  const profile = await getOwnProfile(req, res);
  if (!profile) return null;
  const staff = await StaffUser.findOne({ where: { id: req.params.id, partnerProfileId: profile.id } });
  if (!staff) {
    res.status(404).json({ success: false, message: 'Staff member not found' });
    return null;
  }
  return staff;
}

const toRow = (s) => ({
  id: s.id,
  name: s.name,
  email: s.email,
  role: s.role,
  departments: s.departments || [],
  tenderFields: s.tenderFields || [],
  statesCovered: s.statesCovered || [],
  status: s.status,
  invitedViaCode: s.invitedViaCode,
  createdAt: s.createdAt,
});

// @route GET /api/org/staff
exports.listStaff = async (req, res) => {
  const profile = await getOwnProfile(req, res);
  if (!profile) return;
  try {
    const staff = await StaffUser.findAll({ where: { partnerProfileId: profile.id }, order: [['createdAt', 'DESC']] });
    res.json({ success: true, data: staff.map(toRow) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load staff', error: err.message });
  }
};

// @route PATCH /api/org/staff/:id/approve
exports.approveStaff = async (req, res) => {
  const staff = await getOwnStaffMember(req, res);
  if (!staff) return;
  try {
    staff.status = 'active';
    await staff.save();
    if (isMailConfigured()) {
      sendMail({
        to: staff.email,
        subject: 'Your account has been approved',
        text: `Hi ${staff.name}, your ${STAFF_ROLE_LABELS[staff.role]} registration has been approved. You can now log in with the email and password you registered with.`,
      }).catch((err) => console.error('approveStaff: failed to email staff —', err.message));
    }
    res.json({ success: true, data: toRow(staff) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to approve', error: err.message });
  }
};

// @route PATCH /api/org/staff/:id/reject
exports.rejectStaff = async (req, res) => {
  const staff = await getOwnStaffMember(req, res);
  if (!staff) return;
  try {
    staff.status = 'rejected';
    await staff.save();
    if (isMailConfigured()) {
      sendMail({
        to: staff.email,
        subject: 'Your registration was not approved',
        text: `Hi ${staff.name}, your ${STAFF_ROLE_LABELS[staff.role]} registration was not approved by your organization admin. Contact them directly for details.`,
      }).catch((err) => console.error('rejectStaff: failed to email staff —', err.message));
    }
    res.json({ success: true, data: toRow(staff) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reject', error: err.message });
  }
};

// @route PATCH /api/org/staff/:id
exports.updateStaff = async (req, res) => {
  const staff = await getOwnStaffMember(req, res);
  if (!staff) return;
  try {
    const { role, departments, tenderFields, statesCovered } = req.body;
    if (role && ['sales', 'zonal_manager', 'flsp', 'tender_admin', 'finance', 'head', 'rsm'].includes(role)) staff.role = role;
    if (Array.isArray(departments)) staff.departments = departments;
    if (Array.isArray(tenderFields)) staff.tenderFields = tenderFields;
    if (Array.isArray(statesCovered)) staff.statesCovered = statesCovered;
    await staff.save();
    res.json({ success: true, data: toRow(staff) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update', error: err.message });
  }
};

// @route PATCH /api/org/staff/:id/password
// Org admin sets a new password directly (mirrors "they can update the
// password" from the feature ask) — the new value is never emailed, only a
// plain notification that it changed, so the admin communicates it
// out-of-band.
exports.resetStaffPassword = async (req, res) => {
  const staff = await getOwnStaffMember(req, res);
  if (!staff) return;
  try {
    const { password } = req.body;
    if (!password || !PASSWORD_RULE.test(password)) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character' });
    }
    staff.password = await bcrypt.hash(password, 10);
    await staff.save();
    if (isMailConfigured()) {
      sendMail({
        to: staff.email,
        subject: 'Your password was reset',
        text: `Hi ${staff.name}, your organization admin has reset your password. Contact them to get your new password.`,
      }).catch((err) => console.error('resetStaffPassword: failed to email staff —', err.message));
    }
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reset password', error: err.message });
  }
};

// @route PATCH /api/org/staff/:id/deactivate
exports.deactivateStaff = async (req, res) => {
  const staff = await getOwnStaffMember(req, res);
  if (!staff) return;
  try {
    staff.status = 'inactive';
    await staff.save();
    res.json({ success: true, data: toRow(staff) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to deactivate', error: err.message });
  }
};

// @route PATCH /api/org/staff/:id/reactivate
exports.reactivateStaff = async (req, res) => {
  const staff = await getOwnStaffMember(req, res);
  if (!staff) return;
  try {
    staff.status = 'active';
    await staff.save();
    res.json({ success: true, data: toRow(staff) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reactivate', error: err.message });
  }
};

// @route GET /api/org/invite-link
exports.getInviteLink = async (req, res) => {
  const profile = await getOwnProfile(req, res);
  if (!profile) return;
  try {
    const invite = await OrgInviteLink.findOne({ where: { partnerProfileId: profile.id } });
    res.json({ success: true, data: invite ? { code: invite.code } : null });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load invite link', error: err.message });
  }
};

// @route POST /api/org/invite-link
// Generates one if none exists yet, or regenerates (replaces) the existing
// one — old links stop working the moment a new code is issued.
exports.regenerateInviteLink = async (req, res) => {
  const profile = await getOwnProfile(req, res);
  if (!profile) return;
  try {
    const code = crypto.randomBytes(9).toString('base64url');
    const [invite] = await OrgInviteLink.findOrCreate({
      where: { partnerProfileId: profile.id },
      defaults: { partnerProfileId: profile.id, code },
    });
    if (invite.code !== code) {
      invite.code = code;
      await invite.save();
    }
    res.json({ success: true, data: { code: invite.code } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to generate invite link', error: err.message });
  }
};
