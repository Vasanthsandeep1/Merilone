const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/oemRankController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/categories', ctrl.categories);
router.get('/', ctrl.rank);

module.exports = router;
