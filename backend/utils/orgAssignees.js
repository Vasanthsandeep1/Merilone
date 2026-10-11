'use strict';
// Shared "who in this organisation can this be assigned to" helper — the org
// owner (implicit admin) plus every active StaffUser. Used by Task Management
// (and anywhere else that needs an assignee picker) so every feature agrees on
// the same {kind, id, name, email} shape instead of re-deriving it.
const { PartnerProfile, StaffUser, User } = require('../models');

async function listAssignees(req) {
  const owner = await User.findByPk(req.user.id, { attributes: ['id', 'name', 'email'] });
  const options = owner
    ? [{ kind: 'owner', id: owner.id, name: owner.name ? `${owner.name} (Owner)` : 'Organization Owner', email: owner.email }]
    : [];
  const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
  if (profile) {
    const staff = await StaffUser.findAll({ where: { partnerProfileId: profile.id, status: 'active' }, attributes: ['id', 'name', 'email', 'role'], order: [['name', 'ASC']] });
    staff.forEach((s) => options.push({ kind: 'staff', id: s.id, name: s.name, email: s.email, role: s.role }));
  }
  return options;
}

async function resolveAssignee(req, kind, id) {
  if (!kind || id === undefined || id === null || id === '') return null;
  const list = await listAssignees(req);
  return list.find((a) => a.kind === kind && String(a.id) === String(id)) || null;
}

module.exports = { listAssignees, resolveAssignee };
