const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboardController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/tender-admin', ctrl.getTenderAdminDashboard);
router.get('/tender-executive', ctrl.getTenderExecutiveDashboard);
router.get('/zonal-manager', ctrl.getZonalManagerDashboard);
router.get('/zonal-head', ctrl.getZonalHeadDashboard);
router.get('/sales', ctrl.getSalesDashboard);

module.exports = router;
