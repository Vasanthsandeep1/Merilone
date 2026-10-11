const express = require('express');
const router = express.Router();
const { getForecast } = require('../controllers/forecastController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/', getForecast);

module.exports = router;
