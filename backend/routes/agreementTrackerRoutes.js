const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/agreementTrackerController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/export', ctrl.exportExcel);
router.get('/', ctrl.list);
router.put('/:letterId', ctrl.update);

module.exports = router;
