const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/gpTrackerController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', ctrl.list);
router.get('/export', ctrl.exportExcel);
router.put('/cost', ctrl.setCost);

module.exports = router;
