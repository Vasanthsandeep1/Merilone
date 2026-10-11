const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/documentTenderController');
const { protect } = require('../middleware/authMiddleware');
const { uploadTenderDocuments } = require('../middleware/documentTenderUploadMiddleware');

router.use(protect);

router.post('/', uploadTenderDocuments.array('files', 10), ctrl.createFromDocuments);

module.exports = router;
