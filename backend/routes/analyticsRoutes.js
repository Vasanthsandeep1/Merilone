const express = require('express');
const router = express.Router();
const { getSellers, getCompanyProfile, compareBidders } = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/sellers', getSellers);
router.get('/company-profile', getCompanyProfile);
router.get('/compare-bidders', compareBidders);

module.exports = router;
