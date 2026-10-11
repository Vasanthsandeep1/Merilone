// India's zonal council groupings — used to derive a Zone for tenders/pipeline
// rows that only carry a state (gem_tenders has no zone column; `contracts`
// does, via office_zone, so this is only needed for the tender side). Mirrors
// adminApp/src/components/liaisons/geoHelpers.ts's ZONE_BY_STATE.
const ZONE_BY_STATE = {
  Delhi: 'North', Haryana: 'North', 'Himachal Pradesh': 'North', 'Jammu and Kashmir': 'North', Ladakh: 'North',
  Punjab: 'North', Rajasthan: 'North', Chandigarh: 'North', Uttarakhand: 'North',
  'Andhra Pradesh': 'South', Karnataka: 'South', Kerala: 'South', 'Tamil Nadu': 'South', Telangana: 'South',
  Puducherry: 'South', 'Andaman and Nicobar Islands': 'South', Lakshadweep: 'South',
  Bihar: 'East', Jharkhand: 'East', Odisha: 'East', 'West Bengal': 'East', Sikkim: 'East',
  Assam: 'East', 'Arunachal Pradesh': 'East', Manipur: 'East', Meghalaya: 'East', Mizoram: 'East', Nagaland: 'East', Tripura: 'East',
  Goa: 'West', Gujarat: 'West', Maharashtra: 'West', 'Dadra and Nagar Haveli and Daman and Diu': 'West',
  Chhattisgarh: 'Central', 'Madhya Pradesh': 'Central', 'Uttar Pradesh': 'Central',
};
const zoneForState = (state) => ZONE_BY_STATE[state] || 'Other';
module.exports = { ZONE_BY_STATE, zoneForState };
