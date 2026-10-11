const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/queryController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/export', ctrl.exportExcel);
router.get('/assignees', ctrl.assignees);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.get);
router.put('/:id', ctrl.update);
router.post('/:id/reply', ctrl.reply);
router.post('/:id/attachments', ctrl.uploadMiddleware, ctrl.addAttachments);
router.delete('/:id/attachments/:index', ctrl.removeAttachment);
router.delete('/:id', ctrl.remove);

module.exports = router;
