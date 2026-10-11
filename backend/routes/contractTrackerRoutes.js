const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/contractTrackerController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/export', ctrl.exportExcel);
router.get('/', ctrl.list);
router.put('/:contractId', ctrl.update);

module.exports = router;
