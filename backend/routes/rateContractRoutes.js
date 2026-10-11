const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/rateContractController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/export', ctrl.exportExcel);
router.get('/active-rate', ctrl.getActiveRate);
router.post('/check-expiries', ctrl.checkExpiries);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
