// Canonical list of legal/business structures a partner (OEM/Reseller)
// registers under — served via GET /api/auth/organisation-types so the
// frontend never has to keep its own copy in sync, and validated against
// here in registerPartner (authController.js) so a request can't smuggle
// in an arbitrary string.
module.exports = [
  'Proprietorship',
  'Partnership Firm',
  'Limited Liability Partnership (LLP)',
  'Private Limited Company',
  'Public Limited Company',
  'Other',
];
