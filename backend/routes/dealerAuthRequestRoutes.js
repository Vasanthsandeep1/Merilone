const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dealerAuthRequestController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.use(protect);

router.get('/oems', ctrl.listOems);
router.get('/oems/:oemUserId/categories', ctrl.listOemCategories);
router.get('/oems/:oemUserId/subcategories', ctrl.listOemSubCategories);
router.get('/oems/:oemUserId/products', ctrl.listOemProducts);

router.post('/', ctrl.createRequest);
router.get('/verify-tender', ctrl.verifyTender);
router.get('/tracker/export', ctrl.exportTracker);
router.get('/tracker', ctrl.listTracker);
router.get('/sent', ctrl.listSentRequests);
router.get('/received', ctrl.listReceivedRequests);
router.get('/:id', ctrl.getRequest);
router.get('/:id/reseller-profile', ctrl.getResellerProfile);
router.post('/:id/approve', ctrl.approveRequest);
router.post('/:id/reject', ctrl.rejectRequest);
router.post('/:id/documents', upload.single('document'), ctrl.uploadDocument);
router.delete('/:id/documents/:docId', ctrl.removeDocument);

module.exports = router;
