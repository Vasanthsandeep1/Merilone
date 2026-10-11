const express = require('express');
const router = express.Router();
const {
  getProfile, updateSection, uploadLogo,
  createContact, updateContact, deleteContact,
  createLocation, updateLocation, deleteLocation,
  createTaxRegistration, updateTaxRegistration, deleteTaxRegistration,
  createCertificate, updateCertificate, deleteCertificate,
  submitProfile,
  ocrPan, ocrAadhaar, ocrCompanyPan, ocrCompanyGstin, ocrCompanyCin, verifyGemSellerId, verifyBankAccount,
  startTaxDigilocker, getTaxDigilockerStatus,
  sendOtp, verifyOtp
} = require('../controllers/partnerProfileController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.use(protect);

router.get('/', getProfile);
router.patch('/', updateSection);
router.post('/logo', upload.single('logo'), uploadLogo);

router.post('/contacts', createContact);
router.patch('/contacts/:id', updateContact);
router.delete('/contacts/:id', deleteContact);

router.post('/locations', createLocation);
router.patch('/locations/:id', updateLocation);
router.delete('/locations/:id', deleteLocation);

router.post('/tax-registrations', upload.single('document'), createTaxRegistration);
router.patch('/tax-registrations/:id', upload.single('document'), updateTaxRegistration);
router.delete('/tax-registrations/:id', deleteTaxRegistration);

router.post('/certificates', upload.single('document'), createCertificate);
router.patch('/certificates/:id', upload.single('document'), updateCertificate);
router.delete('/certificates/:id', deleteCertificate);

router.post('/submit', submitProfile);

router.post('/ocr/pan', upload.single('file'), ocrPan);
router.post('/ocr/aadhaar', upload.single('file'), ocrAadhaar);
router.post('/ocr/company-pan', upload.single('file'), ocrCompanyPan);
router.post('/ocr/company-gstin', ocrCompanyGstin);
router.post('/ocr/company-cin', ocrCompanyCin);
router.post('/verify-gem-seller-id', verifyGemSellerId);
router.post('/verify-bank-account', verifyBankAccount);
router.post('/digilocker/start', startTaxDigilocker);
router.get('/digilocker/status', getTaxDigilockerStatus);

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);

module.exports = router;
