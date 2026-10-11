const express = require('express');
const router = express.Router();
const {
  registerPartner, getCaptcha, getCompanyTypes, updateCompanyTypes, getOrganisationTypes, login, getProfile,
  registerStaff, searchOrganizations, resolveInviteCode, changePassword,
} = require('../controllers/authController');
const { createSubscription, verifySubscription } = require('../controllers/subscriptionController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register-partner', registerPartner);
router.get('/captcha', getCaptcha);
router.get('/company-types', getCompanyTypes);
router.patch('/company-types', protect, updateCompanyTypes);
router.get('/organisation-types', getOrganisationTypes);
router.post('/subscription/create', createSubscription);
router.post('/subscription/verify', verifySubscription);
router.post('/login', login);
router.get('/me', protect, getProfile);
router.patch('/password', protect, changePassword);

// Org-scoped staff (Sales/Zonal Manager/FLSP) registration — public.
router.post('/register-staff', registerStaff);
router.get('/organizations/search', searchOrganizations);
router.get('/invite/:code', resolveInviteCode);

module.exports = router;
