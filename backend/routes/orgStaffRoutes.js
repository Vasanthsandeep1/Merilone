const express = require('express');
const router = express.Router();
const {
  listStaff, approveStaff, rejectStaff, updateStaff, resetStaffPassword,
  deactivateStaff, reactivateStaff, getInviteLink, regenerateInviteLink,
} = require('../controllers/orgStaffController');
const { protect } = require('../middleware/authMiddleware');

// Staff tokens carry the ORG OWNER'S user id as `id` (see authController.js's
// generateStaffToken), so they'd otherwise pass getOwnProfile's
// `PartnerProfile.findOne({ where: { userId: req.user.id } })` check just
// like the real owner — this is the one place that distinction still has
// to be enforced: managing/approving staff (including themselves) must stay
// owner-only.
const requireOwner = (req, res, next) => {
  if (req.user.userType === 'staff') {
    return res.status(403).json({ success: false, message: 'Only your organization admin can manage staff.' });
  }
  next();
};

router.use(protect, requireOwner);

router.get('/staff', listStaff);
router.patch('/staff/:id/approve', approveStaff);
router.patch('/staff/:id/reject', rejectStaff);
router.patch('/staff/:id', updateStaff);
router.patch('/staff/:id/password', resetStaffPassword);
router.patch('/staff/:id/deactivate', deactivateStaff);
router.patch('/staff/:id/reactivate', reactivateStaff);
router.get('/invite-link', getInviteLink);
router.post('/invite-link', regenerateInviteLink);

module.exports = router;
