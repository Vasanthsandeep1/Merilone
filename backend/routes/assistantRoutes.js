const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/assistantController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.post('/chat', ctrl.uploadMiddleware, ctrl.chat);

module.exports = router;
