const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dealersController');
const resellerSuggestionCtrl = require('../controllers/resellerSuggestionController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

// Dealer Management > Best Reseller
router.get('/reseller-suggestions/meta', resellerSuggestionCtrl.getMeta);
router.get('/reseller-suggestions/search', resellerSuggestionCtrl.searchResellers);
router.get('/reseller-suggestions/selections/mine', resellerSuggestionCtrl.listMySelections);
router.get('/reseller-suggestions/:id', resellerSuggestionCtrl.getResellerProfile);
router.post('/reseller-suggestions/:id/invite', resellerSuggestionCtrl.inviteReseller);
router.post('/reseller-suggestions/authorized/:requestId/invite', resellerSuggestionCtrl.inviteAuthorizedReseller);
router.get('/reseller-suggestions', resellerSuggestionCtrl.getTopResellers);

router.get('/report', ctrl.getContractDealers);
router.get('/report/suggestions', ctrl.getDealerSuggestions);
router.get('/report/states', ctrl.getDealerStates);
router.get('/report/categories', ctrl.getDealerCategories);
router.get('/report/contracts', ctrl.getDealerContracts);

router.get('/distributors', ctrl.listDistributors);
router.get('/distributors/states', ctrl.getDistributorStates);
router.post('/distributors', ctrl.createDistributor);
router.post('/distributors/import', ctrl.importDistributors);
router.patch('/distributors/:id', ctrl.updateDistributor);
router.delete('/distributors/:id', ctrl.deleteDistributor);

module.exports = router;
