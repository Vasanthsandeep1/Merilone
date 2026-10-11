const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/opiController');
const { protect } = require('../middleware/authMiddleware');

// OPI Management (Sales / FLSP logins; the Master Admin can view all).
router.use(protect);

router.get('/meta', ctrl.meta);
router.get('/formats', ctrl.formats);
router.post('/formats', ctrl.addDepartment);
router.delete('/formats/:deptKey', ctrl.removeDepartment);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id/pdf', ctrl.pdf);
router.get('/:id/excel', ctrl.excel);
router.post('/:id/email', ctrl.email);
router.get('/:id', ctrl.get);

module.exports = router;
