const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/quotationController');
const { protect } = require('../middleware/authMiddleware');
const { uploadLogo, uploadQuotationFile } = require('../middleware/quotationUploadMiddleware');

router.use(protect);

router.get('/next-number', ctrl.getNextNumber);
router.get('/stats', ctrl.getStats);
router.get('/', ctrl.listQuotations);
router.post('/', uploadLogo.single('logo'), ctrl.createQuotation);
router.post('/upload', uploadQuotationFile.single('file'), ctrl.uploadQuotation);

router.get('/:id', ctrl.getQuotation);
router.patch('/:id', uploadLogo.single('logo'), ctrl.updateQuotation);
router.patch('/:id/status', ctrl.setStatus);
router.delete('/:id', ctrl.deleteQuotation);
router.get('/:id/pdf', ctrl.downloadPdf);
router.post('/:id/email', ctrl.emailQuotation);
router.get('/:id/file', ctrl.downloadUploadedFile);

module.exports = router;
