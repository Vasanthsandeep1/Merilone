const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/m1StoreController');
const { protect } = require('../middleware/authMiddleware');

// Service Management > Quote Requests (B2G portal).
router.use(protect);

router.get('/', ctrl.portalList);
router.put('/:id', ctrl.portalUpdate);

module.exports = router;
