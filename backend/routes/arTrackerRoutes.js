const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/arTrackerController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', ctrl.list);
router.get('/export', ctrl.exportExcel);

module.exports = router;
