const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const c = require('../controllers/letterGenerateController');

const router = express.Router();
router.use(protect);

router.get('/formats', c.listFormats);
router.get('/share-recipients', c.getShareRecipients);

router.get('/folders', c.listFolders);
router.post('/folders', c.createFolder);
router.patch('/folders/:id', c.renameFolder);
router.delete('/folders/:id', c.deleteFolder);

router.get('/documents', c.listDocuments);
router.post('/documents', c.createDocument);
router.get('/documents/:id', c.getDocument);
router.patch('/documents/:id', c.updateDocument);
router.delete('/documents/:id', c.deleteDocument);
router.get('/documents/:id/preview', c.previewDocument);
router.get('/documents/:id/download', c.downloadDocument);
router.post('/documents/:id/share', c.shareDocument);

router.post('/upload', c.uploadMiddleware, c.uploadFile);
router.post('/chat', c.chatGenerate);

module.exports = router;
