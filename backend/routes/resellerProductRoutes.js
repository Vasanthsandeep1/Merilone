const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/resellerProductController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/catalogUploadMiddleware');

router.use(protect);

router.get('/', ctrl.listProducts);
router.get('/oems', ctrl.listProductOems);
router.get('/approved-authorizations', ctrl.listApprovedAuthorizations);
router.post('/', ctrl.createProduct);
router.patch('/:id', ctrl.updateProduct);
router.delete('/:id', ctrl.deleteProduct);
router.post('/:id/catalog', upload.single('file'), ctrl.uploadCatalog);
router.get('/:id/catalog/download', ctrl.downloadCatalog);

module.exports = router;
