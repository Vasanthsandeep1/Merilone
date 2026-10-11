// Starting suggestions only — NOT an enum. A partner (OEM or Reseller) types
// its own department/division name during Setup Profile; these are just
// offered as autocomplete suggestions (Meril's own well-known divisions),
// alongside whatever divisions other organisations have already typed in
// (see partnerDivisionController.js's suggestDivisions). Any organisation can
// type something entirely different — an arbitrary string is a valid division.
module.exports = ['Diagnostics', 'Endo-Surgery', '360 Vertical'];
