const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/liaisonController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/facets', ctrl.getFacets);
router.get('/recommend', ctrl.recommend);
router.get('/rank', ctrl.rank);
router.get('/export', ctrl.exportExcel);
router.get('/interactions', ctrl.listInteractions);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.detail);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:id/interactions', ctrl.addInteraction);

module.exports = router;
