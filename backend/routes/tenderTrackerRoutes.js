const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/tenderTrackerController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/remark-options', ctrl.getRemarkOptions);
router.get('/verticals', ctrl.getVerticals);
router.get('/export', ctrl.exportExcel);
router.get('/', ctrl.listTracker);
router.post('/', ctrl.createEntry);
router.put('/:id', ctrl.updateEntry);
router.delete('/:id', ctrl.deleteEntry);

module.exports = router;
