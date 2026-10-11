const express = require('express');
const multer = require('multer');
const router = express.Router();
const {
  getTenders, getFilters, getMyDepartments, getSubCategories, getTenderDetails, getDashboardStats,
  toggleInterest, setNotRelevant, getStatusHistory, postStatus,
  getSuggestedProducts, selectSuggestedProduct, generateSuggestedProducts,
  saveSuggestedProducts, recalculateSuggestion, importSuggestionsFromSpreadsheet, searchProducts,
  getParticipatedTenders, updateParticipatedTenderNote, getActiveWorkspaces, deleteWorkspace, getTenderSummary, getSuggestedPricing,
} = require('../controllers/tenderController');
const {
  getDeviations, updateDeviations, exportDeviationsExcel, importDeviationsExcel,
  generateRepresentationLetter, saveRepresentationLetter, getRepresentationLetter,
  getShareRecipients, shareDeviation,
} = require('../controllers/deviationController');
const {
  getProcessDecode, submitProcessDecode, updateProcessDecodePayload, decideProcessDecode,
} = require('../controllers/processDecodeController');
const { protect } = require('../middleware/authMiddleware');

// In-memory only — the Deviations Excel import is parsed straight into
// JSON and never needs to be persisted to disk (see
// deviationController.importDeviationsExcel).
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(protect);

router.get('/stats/summary', getDashboardStats);
router.get('/filters', getFilters);
router.get('/my-departments', getMyDepartments);
router.get('/subcategories', getSubCategories);
router.get('/participated', getParticipatedTenders);
router.get('/workspaces', getActiveWorkspaces);
router.delete('/workspaces/:bidNumber', deleteWorkspace);
router.get('/products/search', searchProducts);
router.put('/:bidNumber/participated-note', updateParticipatedTenderNote);
router.get('/', getTenders);
router.patch('/:bidNumber/interest', toggleInterest);
router.patch('/:bidNumber/not-relevant', setNotRelevant);
router.get('/:bidNumber/status/history', getStatusHistory);
router.post('/:bidNumber/status', postStatus);
router.get('/:bidNumber/suggestions', getSuggestedProducts);
router.put('/:bidNumber/suggestions', saveSuggestedProducts);
router.post('/:bidNumber/suggestions/select', selectSuggestedProduct);
router.post('/:bidNumber/suggestions/generate', generateSuggestedProducts);
router.post('/:bidNumber/suggestions/recalculate', recalculateSuggestion);
router.post('/:bidNumber/suggestions/from-spreadsheet', importSuggestionsFromSpreadsheet);
router.post('/:bidNumber/summary', getTenderSummary);
router.get('/:bidNumber/suggested-pricing', getSuggestedPricing);
router.get('/:bidNumber/deviations', getDeviations);
router.put('/:bidNumber/deviations', updateDeviations);
router.get('/:bidNumber/deviations/export', exportDeviationsExcel);
router.post('/:bidNumber/deviations/import', excelUpload.single('file'), importDeviationsExcel);
router.post('/:bidNumber/deviations/generate-representation', generateRepresentationLetter);
router.post('/:bidNumber/deviations/save-representation', saveRepresentationLetter);
router.get('/:bidNumber/deviations/representation', getRepresentationLetter);
router.get('/:bidNumber/deviations/share-recipients', getShareRecipients);
router.post('/:bidNumber/deviations/share', shareDeviation);
router.get('/:bidNumber/process-decode', getProcessDecode);
router.post('/:bidNumber/process-decode', submitProcessDecode);
router.patch('/:bidNumber/process-decode/:id/payload', updateProcessDecodePayload);
router.post('/:bidNumber/process-decode/:id/decide', decideProcessDecode);
router.get('/:bidNumber', getTenderDetails);

module.exports = router;
