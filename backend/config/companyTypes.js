// Canonical list of company/industry verticals a partner (OEM/Reseller)
// account can register under — served via GET /api/auth/company-types so
// the frontend never has to keep its own copy in sync, and validated
// against here in registerPartner (authController.js) so a request can't
// smuggle in an arbitrary string.
module.exports = [
  'Medical Devices & Equipment',
  'Medical Software / HealthTech',
  'Electricals & Electronics',
  'Pharmaceuticals',
  'Biotechnology',
  'Diagnostics & Laboratory',
  'Hospital / Healthcare Services',
  'Manufacturing & Industrial',
  'Logistics & Supply Chain',
  'Research & Academia',
  'Other',
];
