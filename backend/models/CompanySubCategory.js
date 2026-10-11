module.exports = (sequelize, DataTypes) => {
  const CompanySubCategory = sequelize.define('CompanySubCategory', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    categoryId: { type: DataTypes.INTEGER, allowNull: false, field: 'category_id' },
    name: { type: DataTypes.STRING, allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' }
  }, {
    tableName: 'company_sub_categories',
    timestamps: true
  });

  return CompanySubCategory;
};
