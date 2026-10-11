const express = require('express');
const router = express.Router();
const { rank } = require('../controllers/teamRankController');
const { protect } = require('../middleware/authMiddleware');

// Owner-only, same as /api/org/staff — ranking the team is a management view,
// a staff login should not see how they and their colleagues are scored.
const requireOwner = (req, res, next) => {
  if (req.user.userType === 'staff') {
    return res.status(403).json({ success: false, message: 'Only your organization admin can view team ranking.' });
  }
  next();
};

router.use(protect, requireOwner);
router.get('/', rank);

module.exports = router;
