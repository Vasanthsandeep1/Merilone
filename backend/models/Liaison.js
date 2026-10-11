// Liaison Management — an organisation's own directory of liaison contacts
// (government/hospital/department officials they work through to progress
// tenders), scored and ranked from real logged activity (see
// models/LiaisonInteraction.js) rather than a manually-typed ranking. Scoped
// by userId like every other org-owned register in this app (staff tokens
// carry the org owner's id).
module.exports = (sequelize, DataTypes) => sequelize.define('Liaison', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  name: { type: DataTypes.STRING(200), allowNull: false },
  photoUrl: { type: DataTypes.STRING, allowNull: true, field: 'photo_url' },
  designation: { type: DataTypes.STRING(200), allowNull: true },
  organization: { type: DataTypes.STRING(300), allowNull: true },
  orgType: {
    type: DataTypes.ENUM('government_hospital', 'state_health_dept', 'municipal_corporation', 'psu', 'educational_institution', 'central_govt', 'other'),
    allowNull: false, defaultValue: 'other', field: 'org_type',
  },
  department: { type: DataTypes.STRING(200), allowNull: true },
  hospital: { type: DataTypes.STRING(300), allowNull: true },
  state: { type: DataTypes.STRING(100), allowNull: true },
  city: { type: DataTypes.STRING(100), allowNull: true },
  zone: { type: DataTypes.ENUM('North', 'South', 'East', 'West', 'Central'), allowNull: true },
  district: { type: DataTypes.STRING(100), allowNull: true },
  // From the "Lisonar Tracker.xlsx" import — a specific tender/product a
  // liaison is tied to, kept alongside the directory fields the Add Liaison
  // form actually collects (see models/LiaisonInteraction.js for the real,
  // ongoing per-tender activity log; these two are just the one row of
  // legacy spreadsheet context carried over for a liaison imported that way).
  tenderReference: { type: DataTypes.STRING(200), allowNull: true, field: 'tender_reference' },
  product: { type: DataTypes.STRING(300), allowNull: true },
  division: { type: DataTypes.STRING(20), allowNull: true },
  liaisonType: { type: DataTypes.STRING(100), allowNull: true, field: 'liaison_type' },
  specialization: { type: DataTypes.STRING(300), allowNull: true },
  phone: { type: DataTypes.STRING(30), allowNull: true },
  email: { type: DataTypes.STRING(200), allowNull: true },
  preferredContactMethod: { type: DataTypes.ENUM('phone', 'email', 'whatsapp', 'in_person'), allowNull: false, defaultValue: 'phone', field: 'preferred_contact_method' },
  experienceYears: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'experience_years' },
  availability: { type: DataTypes.ENUM('available', 'busy', 'unavailable'), allowNull: false, defaultValue: 'available' },
  remarks: { type: DataTypes.TEXT, allowNull: true },
  createdByName: { type: DataTypes.STRING, allowNull: true, field: 'created_by_name' },
}, {
  tableName: 'liaisons',
  timestamps: true,
  underscored: true,
  indexes: [
    { name: 'idx_liaison_user_state', fields: ['user_id', 'state'] },
    { name: 'idx_liaison_user_zone', fields: ['user_id', 'zone'] },
  ],
});
