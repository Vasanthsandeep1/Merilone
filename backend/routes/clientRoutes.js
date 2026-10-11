const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/clientController');
const { protect } = require('../middleware/authMiddleware');
const { uploadLogo, uploadAttachment } = require('../middleware/clientUploadMiddleware');

router.use(protect);

router.get('/filters', ctrl.getClientFilters);
router.get('/export.csv', ctrl.exportCsv);
router.get('/contacts/available', ctrl.getAvailableContacts);

router.get('/', ctrl.listClients);
router.post('/', uploadLogo.single('logo'), ctrl.createClient);
router.get('/:id', ctrl.getClient);
router.patch('/:id', uploadLogo.single('logo'), ctrl.updateClient);
router.patch('/:id/archive', ctrl.setArchived);
router.delete('/:id', ctrl.deleteClient);

router.post('/:id/shipping', ctrl.addShippingDetail);
router.delete('/:id/shipping/:shippingId', ctrl.deleteShippingDetail);

router.post('/:id/contacts', ctrl.linkContact);
router.delete('/:id/contacts/:linkId', ctrl.unlinkContact);

router.post('/:id/attachments', uploadAttachment.single('file'), ctrl.uploadAttachment);
router.get('/:id/attachments/:attachmentId/download', ctrl.downloadAttachment);
router.delete('/:id/attachments/:attachmentId', ctrl.deleteAttachment);

router.get('/:id/invoices', ctrl.getInvoices);

module.exports = router;
