const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/m1AdController');
const { protect } = require('../middleware/authMiddleware');

// Service Management > Post Ads (B2G portal).
router.use(protect);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
