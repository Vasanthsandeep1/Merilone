const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/paymentReceiptController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/next-number', ctrl.getNextNumber);
router.get('/unpaid-invoices', ctrl.getUnpaidInvoices);
router.get('/stats', ctrl.getStats);
router.get('/', ctrl.listPaymentReceipts);
router.post('/', ctrl.createPaymentReceipt);

router.get('/:id', ctrl.getPaymentReceipt);
router.patch('/:id', ctrl.updatePaymentReceipt);
router.delete('/:id', ctrl.deletePaymentReceipt);
router.get('/:id/pdf', ctrl.downloadPdf);
router.post('/:id/email', ctrl.emailReceipt);

module.exports = router;
