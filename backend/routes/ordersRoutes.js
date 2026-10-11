const express = require('express');
const router = express.Router();
const {
  getOverview,
  getGemContracts, getContractFilters, exportGemContracts, getContractDetail,
  getCartingSellers, getCartingStates, getCartingYears, getCartingKpi, getCartingPivot, getCartingMap,
} = require('../controllers/ordersController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/overview', getOverview);

router.get('/gem-contracts', getGemContracts);
router.get('/gem-contracts/filters', getContractFilters);
router.get('/gem-contracts/export', exportGemContracts);
router.get('/gem-contracts/:id', getContractDetail);

router.get('/carting/sellers', getCartingSellers);
router.get('/carting/states', getCartingStates);
router.get('/carting/years', getCartingYears);
router.get('/carting/kpi', getCartingKpi);
router.get('/carting/pivot', getCartingPivot);
router.get('/carting/map', getCartingMap);

module.exports = router;
