const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', ctrl.listNotifications);
router.patch('/:id/read', ctrl.markRead);
router.post('/read-all', ctrl.markAllRead);

module.exports = router;
