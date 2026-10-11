const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/workspaceController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/workspaceUploadMiddleware');

router.use(protect);

router.get('/:bidNumber/overview', ctrl.getOverview);

router.get('/:bidNumber/departments', ctrl.listDepartments);
router.post('/:bidNumber/departments', ctrl.createDepartment);
router.patch('/:bidNumber/departments/:id', ctrl.renameDepartment);
router.delete('/:bidNumber/departments/:id', ctrl.deleteDepartment);

router.get('/:bidNumber/tasks', ctrl.listTasks);
router.post('/:bidNumber/tasks', ctrl.createTask);
router.patch('/:bidNumber/tasks/:id', ctrl.updateTask);
router.delete('/:bidNumber/tasks/:id', ctrl.deleteTask);

router.get('/:bidNumber/deadlines', ctrl.listDeadlines);
router.post('/:bidNumber/deadlines', ctrl.createDeadline);
router.delete('/:bidNumber/deadlines/:id', ctrl.deleteDeadline);

router.get('/:bidNumber/documents', ctrl.listDocuments);
router.post('/:bidNumber/documents', upload.single('file'), ctrl.uploadDocument);
router.post('/:bidNumber/documents/merge-upload', upload.single('file'), ctrl.uploadMergedDocument);
router.post('/:bidNumber/documents/transcribe-page', upload.single('file'), ctrl.transcribePage);
router.get('/:bidNumber/documents/:id/download', ctrl.downloadDocument);
router.get('/:bidNumber/documents/:id/view', ctrl.viewDocument);
router.get('/:bidNumber/documents/:id/pdf', ctrl.getDocumentAsPdf);
router.delete('/:bidNumber/documents/:id', ctrl.deleteDocument);

router.get('/:bidNumber/mydocs', ctrl.listMyDocs);
router.post('/:bidNumber/mydocs', ctrl.createMyDoc);
router.post('/:bidNumber/mydocs/merge', ctrl.mergeMyDocs);
router.patch('/:bidNumber/mydocs/:id', ctrl.updateMyDoc);
router.delete('/:bidNumber/mydocs/:id', ctrl.deleteMyDoc);
router.get('/:bidNumber/mydocs/:id/export', ctrl.exportMyDoc);
router.get('/:bidNumber/mydocs/:id/pdf', ctrl.getMyDocAsPdf);

router.get('/:bidNumber/doc-prep', ctrl.getDocPrepSession);
router.post('/:bidNumber/doc-prep/analyze', ctrl.analyzeDocPrep);
router.post('/:bidNumber/doc-prep/reset', ctrl.resetDocPrep);
router.get('/:bidNumber/doc-prep/library-search', ctrl.searchDocPrepLibrary);
router.post('/:bidNumber/doc-prep/annexure', ctrl.createCustomAnnexure);
router.post('/:bidNumber/doc-prep/annexure/upload', upload.single('file'), ctrl.uploadNewAnnexureDocument);
router.post('/:bidNumber/doc-prep/annexure/import-library', ctrl.importNewAnnexureFromLibrary);

router.post('/:bidNumber/doc-prep/upload-bid', upload.single('file'), ctrl.uploadBidDocument);
router.post('/:bidNumber/doc-prep/import-bid', ctrl.importBidDocumentFromDocuments);
router.delete('/:bidNumber/doc-prep/bid-doc', ctrl.removeBidDocument);
router.get('/:bidNumber/doc-prep/bid-doc/view', ctrl.viewBidDocument);
router.post('/:bidNumber/doc-prep/upload-additional', upload.single('file'), ctrl.uploadAdditionalDoc);
router.delete('/:bidNumber/doc-prep/additional/:docId', ctrl.deleteAdditionalDoc);
router.post('/:bidNumber/doc-prep/detected/:docId/accept', ctrl.acceptDetectedDoc);
router.post('/:bidNumber/doc-prep/detected/:docId/reject', ctrl.rejectDetectedDoc);

router.get('/:bidNumber/doc-prep/checklist', ctrl.listChecklist);
router.post('/:bidNumber/doc-prep/checklist', ctrl.addChecklistRow);
router.post('/:bidNumber/doc-prep/checklist/sync-annexures', ctrl.syncChecklistFromAnnexures);
router.post('/:bidNumber/doc-prep/checklist/recompute', ctrl.recomputeChecklistRows);
router.post('/:bidNumber/doc-prep/checklist/apply-page-map', ctrl.applyChecklistPageMap);
router.patch('/:bidNumber/doc-prep/checklist/:rowId', ctrl.updateChecklistRow);
router.delete('/:bidNumber/doc-prep/checklist/:rowId', ctrl.deleteChecklistRow);

router.post('/:bidNumber/doc-prep/:annexureId/draft', ctrl.draftAnnexure);
router.post('/:bidNumber/doc-prep/:annexureId/revise', ctrl.reviseAnnexure);
router.post('/:bidNumber/doc-prep/:annexureId/recheck', ctrl.recheckAnnexure);
router.post('/:bidNumber/doc-prep/:annexureId/share', ctrl.shareAnnexure);
router.post('/:bidNumber/doc-prep/:annexureId/push-to-mydocs', ctrl.pushAnnexureToMyDocs);
router.post('/:bidNumber/doc-prep/:annexureId/import-library', ctrl.importLibraryForAnnexure);
router.post('/:bidNumber/doc-prep/:annexureId/stamp-upload', upload.single('file'), ctrl.uploadStampCopy);
router.get('/:bidNumber/doc-prep/:annexureId/export', ctrl.exportAnnexure);
router.get('/:bidNumber/doc-prep/:annexureId/download', ctrl.downloadAnnexure);
router.patch('/:bidNumber/doc-prep/:annexureId', ctrl.updateAnnexureStatus);
router.delete('/:bidNumber/doc-prep/:annexureId', ctrl.deleteAnnexure);

router.get('/:bidNumber/team', ctrl.listTeam);

module.exports = router;
