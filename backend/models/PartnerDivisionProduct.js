// View Profile > Products — a partner's own product catalogue, kept per
// department division (see config/departmentDivisions.js): product code,
// name, category, a short bio-data description, an image and an optional
// brochure/datasheet file. Added either one at a time (manual form) or many
// at once (Excel bulk upload — see partnerDivisionController.js). Scoped by
// userId like every other org-owned table (staff tokens carry the owner's id).
module.exports = (sequelize, DataTypes) => sequelize.define('PartnerDivisionProduct', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  division: { type: DataTypes.STRING(30), allowNull: false },
  productCode: { type: DataTypes.STRING(100), allowNull: true, field: 'product_code' },
  productName: { type: DataTypes.STRING(300), allowNull: false, field: 'product_name' },
  category: { type: DataTypes.STRING(150), allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  imageUrl: { type: DataTypes.STRING, allowNull: true, field: 'image_url' },
  brochureUrl: { type: DataTypes.STRING, allowNull: true, field: 'brochure_url' },
  brochureFileName: { type: DataTypes.STRING, allowNull: true, field: 'brochure_file_name' },
  source: { type: DataTypes.ENUM('manual', 'bulk'), allowNull: false, defaultValue: 'manual' },
  createdByName: { type: DataTypes.STRING, allowNull: true, field: 'created_by_name' },
}, {
  tableName: 'partner_division_products',
  timestamps: true,
  underscored: true,
  indexes: [{ name: 'idx_pdp_user_division', fields: ['user_id', 'division'] }],
});
