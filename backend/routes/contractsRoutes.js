const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/contractsController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', ctrl.getContracts);
router.get('/meta/filters', ctrl.getFilters);
router.get('/export', ctrl.exportContracts);
router.get('/:id', ctrl.getContractById);

module.exports = router;
