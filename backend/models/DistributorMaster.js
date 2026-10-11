// Distributor master — the company's SAP customer master for its divisions, imported from
// the "Distributor Data" workbooks (Endo, Endo Micro, Diagno) by
// scripts/import_distributor_master.js. Shared, read-only reference data (like the
// automation site's `distributors` table); what each distributor covers is layered on
// top per organisation in DistributorMapping.
module.exports = (sequelize, DataTypes) => sequelize.define('DistributorMaster', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sapCode: { type: DataTypes.STRING(30), allowNull: false, field: 'sap_code' },
  // endo = Endo-Surgery distributors, micro = Endo micro-distributors, diagno = Diagnostics customers
  division: { type: DataTypes.ENUM('endo', 'micro', 'diagno'), allowNull: false },
  name: { type: DataTypes.STRING(300), allowNull: false },
  normName: { type: DataTypes.STRING(300), allowNull: true, field: 'norm_name' },
  city: { type: DataTypes.STRING(120), allowNull: true },
  district: { type: DataTypes.STRING(120), allowNull: true },
  state: { type: DataTypes.STRING(80), allowNull: true },
  pincode: { type: DataTypes.STRING(12), allowNull: true },
  gstNo: { type: DataTypes.STRING(20), allowNull: true, field: 'gst_no' },
  email: { type: DataTypes.STRING(200), allowNull: true },
  phone: { type: DataTypes.STRING(60), allowNull: true },
  contactPerson: { type: DataTypes.STRING(150), allowNull: true, field: 'contact_person' },
  classCode: { type: DataTypes.STRING(10), allowNull: true, field: 'class_code' },
  classDescription: { type: DataTypes.STRING(80), allowNull: true, field: 'class_description' },
  // false for hospitals / labs / blood banks in the Diagno customer list
  isDistributor: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_distributor' },
  isAuthorised: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_authorised' },
  registeredOn: { type: DataTypes.DATEONLY, allowNull: true, field: 'registered_on' },
  drugLicenseNo: { type: DataTypes.STRING(150), allowNull: true, field: 'drug_license_no' },
  // map position (scripts/geocode_distributors.js): 'pin' = exact PIN code, 'place' = city name, 'pin3' = postal district
  lat: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
  lng: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
  geoLevel: { type: DataTypes.STRING(10), allowNull: true, field: 'geo_level' },
  drugLicenseExpiry: { type: DataTypes.DATEONLY, allowNull: true, field: 'drug_license_expiry' },
}, {
  tableName: 'distributor_master',
  timestamps: false,
  indexes: [
    { name: 'uk_dm_div_code', unique: true, fields: ['division', 'sap_code'] },
    { name: 'idx_dm_state', fields: ['state'] },
    { name: 'idx_dm_norm', fields: ['norm_name'] },
    { name: 'idx_dm_isdist', fields: ['is_distributor'] },
  ],
});
