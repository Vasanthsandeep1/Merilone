const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/liaisonPayoutController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.use(protect);

router.get('/', ctrl.list);
router.post('/', upload.array('documents', 10), ctrl.create);
router.get('/:id', ctrl.detail);
router.post('/:id/zh-approve', ctrl.zhApprove);
router.post('/:id/ta-approve', ctrl.taApprove);
router.post('/:id/finance-approve', ctrl.financeApprove);
router.post('/:id/head-approve', ctrl.headApprove);
router.post('/:id/reject', ctrl.reject);

module.exports = router;
