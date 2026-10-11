const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/representationTrackerController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/export', ctrl.exportExcel);
router.get('/', ctrl.list);
router.put('/:bidNumber', ctrl.update);

module.exports = router;
