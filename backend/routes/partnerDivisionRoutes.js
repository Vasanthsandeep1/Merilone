const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/partnerDivisionController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', ctrl.listDivisions);
router.get('/suggest', ctrl.suggestDivisions);

router.get('/products', ctrl.listProducts);
router.post('/products', ctrl.productUploadMiddleware, ctrl.createProduct);
router.post('/products/bulk', ctrl.excelUploadMiddleware, ctrl.bulkUploadProducts);
router.patch('/products/:id', ctrl.productUploadMiddleware, ctrl.updateProduct);
router.delete('/products/:id', ctrl.removeProduct);

router.get('/documents', ctrl.listDocuments);
router.patch('/documents/mode', ctrl.setDocumentMode);
router.post('/documents/:division', ctrl.docUploadMiddleware, ctrl.upsertDocument);
router.delete('/documents/:division/:field', ctrl.removeDocumentAsset);

module.exports = router;
