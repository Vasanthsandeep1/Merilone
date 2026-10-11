// Top of the Company Type -> Category -> Sub-Category -> Product hierarchy
// (SETUP_PROFILE.txt section 24). `name` matches a value from
// config/companyTypes.js (the categories chosen at registration) so the
// setup wizard can look up "your selected business categories" by name —
// see productMasterController.js. Managed by a Super Admin in principle
// (add/edit/disable/delete, per section 18); no Super Admin UI/role exists
// in this app yet, so for now these are seeded directly (see
// migrate_setup_profile.js) and only read through the API.
module.exports = (sequelize, DataTypes) => {
  const CompanyCategory = sequelize.define('CompanyCategory', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' }
  }, {
    tableName: 'company_categories',
    timestamps: true
  });

  return CompanyCategory;
};
