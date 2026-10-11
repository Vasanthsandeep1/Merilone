const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/distributorRecommendController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.post('/chat', ctrl.chat);

module.exports = router;
