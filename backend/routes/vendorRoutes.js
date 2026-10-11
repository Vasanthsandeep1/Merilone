const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/vendorController');
const { protect } = require('../middleware/authMiddleware');
const { uploadLogo, uploadAttachment } = require('../middleware/vendorUploadMiddleware');

router.use(protect);

router.get('/filters', ctrl.getVendorFilters);
router.get('/export.csv', ctrl.exportCsv);
router.get('/contacts/available', ctrl.getAvailableContacts);

router.get('/', ctrl.listVendors);
router.post('/', uploadLogo.single('logo'), ctrl.createVendor);

router.get('/:id', ctrl.getVendor);
router.patch('/:id', uploadLogo.single('logo'), ctrl.updateVendor);
router.patch('/:id/archive', ctrl.setArchived);
router.delete('/:id', ctrl.deleteVendor);

router.post('/:id/contacts', ctrl.linkContact);
router.delete('/:id/contacts/:linkId', ctrl.unlinkContact);

router.post('/:id/attachments', uploadAttachment.single('file'), ctrl.uploadAttachment);
router.get('/:id/attachments/:attachmentId/download', ctrl.downloadAttachment);
router.delete('/:id/attachments/:attachmentId', ctrl.deleteAttachment);

module.exports = router;
