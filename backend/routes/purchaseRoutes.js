const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/purchaseController');
const { protect } = require('../middleware/authMiddleware');
const { uploadLogo, uploadPurchaseFile } = require('../middleware/purchaseUploadMiddleware');

router.use(protect);

router.get('/next-number', ctrl.getNextNumber);
router.get('/stats', ctrl.getStats);
router.get('/', ctrl.listPurchases);
router.post('/', uploadLogo.single('logo'), ctrl.createPurchase);
router.post('/upload', uploadPurchaseFile.single('file'), ctrl.uploadPurchase);

router.get('/:id', ctrl.getPurchase);
router.patch('/:id', uploadLogo.single('logo'), ctrl.updatePurchase);
router.patch('/:id/status', ctrl.setStatus);
router.delete('/:id', ctrl.deletePurchase);
router.get('/:id/pdf', ctrl.downloadPdf);
router.get('/:id/file', ctrl.downloadUploadedFile);

module.exports = router;
