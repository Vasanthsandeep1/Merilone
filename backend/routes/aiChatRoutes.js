const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/aiChatController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/latest', ctrl.latest);
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
