'use strict';
// SAMPLE DATA (public repo): the real roster (state -> Zonal Head / FLSP) is
// kept out of this repository. Replace with your organisation's roster.
const ZH = {
  'Tamil Nadu': 'Sample Zonal Head South', 'Karnataka': 'Sample Zonal Head South', 'Kerala': 'Sample Zonal Head South',
  'Delhi': 'Sample Zonal Head North', 'Uttar Pradesh': 'Sample Zonal Head North',
  'Maharashtra': 'Sample Zonal Head West', 'Gujarat': 'Sample Zonal Head West',
  'West Bengal': 'Sample Zonal Head East', 'Odisha': 'Sample Zonal Head East',
};
const FLSP = { 'Tamil Nadu': 'Sample FLSP One', 'Delhi': 'Sample FLSP Two' };
const STATES_BY_ZH = {};
for (const [state, zh] of Object.entries(ZH)) (STATES_BY_ZH[zh] = STATES_BY_ZH[zh] || []).push(state);
const ZH_LIST = Object.keys(STATES_BY_ZH).sort();
module.exports = { ZH, FLSP, STATES_BY_ZH, ZH_LIST };
