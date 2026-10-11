const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/ldTrackerController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', ctrl.list);
router.get('/export', ctrl.exportExcel);
router.put('/:source/:sourceId', ctrl.update);

module.exports = router;
