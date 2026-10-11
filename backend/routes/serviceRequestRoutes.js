const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/serviceRequestController');
const { protect } = require('../middleware/authMiddleware');

// Service Management > Service Requests (Meril One bookings).
router.use(protect);

router.get('/', ctrl.list);

module.exports = router;
