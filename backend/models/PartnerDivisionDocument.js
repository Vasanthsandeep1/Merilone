// View Profile > Document Format — a partner's own letterhead, signature,
// footer and watermark images, one row per division (or division = '__common__'
// when PartnerProfile.documentsShared is true and the same set applies to every
// division — some companies brand every division identically, others differ,
// see PartnerProfile.documentsShared). Meant to feed letter/agreement
// generation the same way utils/letterheads.js does for Meril's own two
// divisions, just per-partner instead of hardcoded.
module.exports = (sequelize, DataTypes) => sequelize.define('PartnerDivisionDocument', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  division: { type: DataTypes.STRING(30), allowNull: false },
  letterheadUrl: { type: DataTypes.STRING, allowNull: true, field: 'letterhead_url' },
  signatureUrl: { type: DataTypes.STRING, allowNull: true, field: 'signature_url' },
  footerUrl: { type: DataTypes.STRING, allowNull: true, field: 'footer_url' },
  watermarkUrl: { type: DataTypes.STRING, allowNull: true, field: 'watermark_url' },
  updatedByName: { type: DataTypes.STRING, allowNull: true, field: 'updated_by_name' },
}, {
  tableName: 'partner_division_documents',
  timestamps: true,
  underscored: true,
  indexes: [{ name: 'uk_pdd_user_division', unique: true, fields: ['user_id', 'division'] }],
});
