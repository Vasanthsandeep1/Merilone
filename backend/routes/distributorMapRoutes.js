const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/distributorMapController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/coverage', ctrl.coverage);
router.get('/rank/export', ctrl.exportRanking);
router.get('/rank', ctrl.rank);
router.get('/selections', ctrl.listSelections);
router.put('/selections/:distributorId', ctrl.saveSelection);
router.delete('/selections/:distributorId', ctrl.removeSelection);
router.get('/state', ctrl.stateDetail);
router.get('/cities', ctrl.cities);
router.get('/facets', ctrl.facets);
router.get('/suggest', ctrl.suggest);
router.get('/export', ctrl.exportExcel);
router.get('/', ctrl.search);
router.get('/:id', ctrl.detail);
router.put('/:id/mappings', ctrl.saveMappings);

module.exports = router;
