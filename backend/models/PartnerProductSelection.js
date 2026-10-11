// Which products (from the master hierarchy) a partner selected during
// setup (SETUP_PROFILE.txt sections 7-9) — persists across search/pagination
// on the frontend since it's just a row per selected product, independent
// of whatever page/filter the UI happens to be showing. `productId` is null
// for a custom "+ Add Other Product" entry not yet in the master list
// (captured via `customProductName`, flagged `pendingApproval` until a
// Super Admin — not yet built — adds it to ProductMasterItem for real).
module.exports = (sequelize, DataTypes) => {
  const PartnerProductSelection = sequelize.define('PartnerProductSelection', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    profileId: { type: DataTypes.INTEGER, allowNull: false, field: 'profile_id' },
    categoryId: { type: DataTypes.INTEGER, allowNull: true, field: 'category_id' },
    subCategoryId: { type: DataTypes.INTEGER, allowNull: true, field: 'sub_category_id' },
    productId: { type: DataTypes.INTEGER, allowNull: true, field: 'product_id' },
    customProductName: { type: DataTypes.STRING, allowNull: true, field: 'custom_product_name' },
    pendingApproval: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'pending_approval' }
  }, {
    tableName: 'partner_product_selections',
    timestamps: true
  });

  return PartnerProductSelection;
};
