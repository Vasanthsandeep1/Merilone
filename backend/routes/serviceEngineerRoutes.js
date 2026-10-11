const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/serviceEngineerController');
const { protect } = require('../middleware/authMiddleware');

// Service Management > Service Engineers.
router.use(protect);

router.get('/skills', ctrl.listSkills);
router.post('/skills', ctrl.addSkill);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
