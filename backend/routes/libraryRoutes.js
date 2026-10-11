const express = require('express');
const router = express.Router();
const {
  listItems, searchItems, createFolder, uploadFile, downloadFile, viewFile,
  renameItem, updateExpiry, deleteItem,
} = require('../controllers/libraryController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/libraryUploadMiddleware');

router.use(protect);

router.get('/search', searchItems);
router.get('/', listItems);
router.post('/folder', createFolder);
router.post('/file', upload.single('file'), uploadFile);
router.get('/file/:id/download', downloadFile);
router.get('/file/:id/view', viewFile);
router.patch('/:id/expiry', updateExpiry);
router.patch('/:id', renameItem);
router.delete('/:id', deleteItem);

module.exports = router;
