const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/salesIncentiveController');
const { protect } = require('../middleware/authMiddleware');

// Sales targets & incentive eligibility (Sales dashboard + admin page).
router.use(protect);

router.get('/me', ctrl.me);
router.get('/people', ctrl.people);
router.get('/team', ctrl.team);
router.put('/target', ctrl.setTarget);
router.put('/clients', ctrl.setClients);

module.exports = router;
