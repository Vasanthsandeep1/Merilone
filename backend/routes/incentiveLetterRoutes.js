const express = require('express');
const os = require('os');
const multer = require('multer');
const router = express.Router();
const ctrl = require('../controllers/incentiveLetterController');
const { protect } = require('../middleware/authMiddleware');

// The budget workbook is ~26 MB; it's parsed from a temp file and then deleted.
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 200 * 1024 * 1024 } });

router.use(protect);

router.post('/upload', upload.single('file'), ctrl.upload);
router.get('/names', ctrl.names);
router.post('/generate', ctrl.generate);
router.post('/zip', ctrl.zip);
router.get('/', ctrl.list);
router.get('/:id/file', ctrl.file);
router.post('/:id/email', ctrl.email);
router.delete('/:id', ctrl.remove);

module.exports = router;
