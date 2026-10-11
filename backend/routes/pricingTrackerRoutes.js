const express = require('express');
const router = express.Router();
const { getOverview, getCategoryDetail, exportExcel } = require('../controllers/pricingTrackerController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/export', exportExcel);
router.get('/', getOverview);
router.get('/category', getCategoryDetail);

module.exports = router;
