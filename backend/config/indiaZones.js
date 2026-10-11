'use strict';
// Geographic zones for Best Reseller Selection's "supply to this zone"
// filter — distinct from the ZSM sales-org zones in zsmOrg.js (those are
// named after people/sales territories; these are the plain North/South/
// East/West/Central/Northeast split India tenders/resellers are commonly
// grouped by).
const ZONE_STATES = {
  North: ['Delhi', 'Punjab', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Ladakh', 'Uttarakhand', 'Chandigarh'],
  South: ['Andhra Pradesh', 'Telangana', 'Karnataka', 'Kerala', 'Tamil Nadu', 'Puducherry'],
  East: ['West Bengal', 'Odisha', 'Bihar', 'Jharkhand'],
  West: ['Maharashtra', 'Gujarat', 'Goa', 'Rajasthan'],
  Central: ['Madhya Pradesh', 'Chhattisgarh', 'Uttar Pradesh'],
  Northeast: ['Assam', 'Tripura', 'Meghalaya', 'Manipur', 'Mizoram', 'Nagaland', 'Arunachal Pradesh', 'Sikkim'],
};

const ZONE_LIST = Object.keys(ZONE_STATES);

const STATE_TO_ZONE = {};
for (const [zone, states] of Object.entries(ZONE_STATES)) {
  for (const state of states) STATE_TO_ZONE[state] = zone;
}

module.exports = { ZONE_STATES, ZONE_LIST, STATE_TO_ZONE };
