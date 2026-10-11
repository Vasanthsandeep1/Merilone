const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/targetController');
const { protect } = require('../middleware/authMiddleware');

// Target Management (Master Admin).
router.use(protect);

router.get('/meta', ctrl.meta);
router.get('/', ctrl.list);
router.get('/:staffId/letter', ctrl.letter);
router.post('/:staffId/letter/email', ctrl.emailLetter);
router.get('/:staffId', ctrl.get);
router.put('/:staffId', ctrl.save);

module.exports = router;
