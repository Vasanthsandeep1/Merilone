const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/salesDashboardController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/', ctrl.get);

module.exports = router;
