'use strict';

const { PartnerProfile, StaffUser, User } = require('../models');

// Both a partner (org owner) token and a staff token can hit the same
// org-scoped routes (Process Decode, Share) — this resolves "which org,
// and who exactly is acting" for either case in one place, rather than
// duplicating the branch in every controller. Staff tokens carry the
// owner's own user id as `id` (see authController.js's generateStaffToken)
// specifically so org-scoped reads/writes work without this kind of
// resolution at all; this helper is only needed where the actor's own
// identity (not just their org) matters — who submitted/decided something,
// and whether they're a Zonal Manager.
async function resolveActor(req) {
  const partnerProfile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
  if (!partnerProfile) return null;

  if (req.user.userType === 'staff') {
    const staffUser = await StaffUser.findByPk(req.user.staffId);
    if (!staffUser) return null;
    return {
      partnerProfileId: partnerProfile.id,
      actorType: 'staff',
      staffId: staffUser.id,
      userId: null,
      actorName: staffUser.name,
      isZonalManager: staffUser.role === 'zonal_manager',
    };
  }

  const user = await User.findByPk(req.user.id, { attributes: ['id', 'name'] });
  return {
    partnerProfileId: partnerProfile.id,
    actorType: 'user',
    staffId: null,
    userId: req.user.id,
    actorName: user?.name || 'Organization Admin',
    // The org owner previewing the "Zonal Manager" dashboard (see
    // AuthContext's ViewRole + api.ts's X-View-Role header) can also decide
    // Process Decode sheets — lets the same login smoothly test that
    // approval flow instead of needing a second, real Zonal Manager staff
    // account just for a demo. Only ever applies to the owner's own actor
    // (never a staff login above, which always reflects its real DB role),
    // and it's a client-chosen UI preference, not an elevated grant — the
    // owner already has full access to everything in this org regardless.
    isZonalManager: req.headers['x-view-role'] === 'zonal_manager',
  };
}

// True when `a` (an actor object from resolveActor) is the same person who
// submitted/is recorded on a request row — used to block self-approval.
function isSameActor(a, row, staffIdField, userIdField) {
  if (a.actorType === 'staff') return row[staffIdField] === a.staffId;
  return row[userIdField] === a.userId;
}

module.exports = { resolveActor, isSameActor };
