const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/pendingPaymentsController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', ctrl.list);
router.post('/fines', ctrl.createFine);
router.patch('/fines/:id/status', ctrl.setFineStatus);
router.delete('/fines/:id', ctrl.deleteFine);
router.get('/fines/:id/pdf', ctrl.downloadNotice);
router.post('/fines/:id/email', ctrl.emailNotice);

module.exports = router;
