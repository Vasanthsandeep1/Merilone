module.exports = (sequelize, DataTypes) => {
  const ProductMasterItem = sequelize.define('ProductMasterItem', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    subCategoryId: { type: DataTypes.INTEGER, allowNull: false, field: 'sub_category_id' },
    name: { type: DataTypes.STRING, allowNull: false },
    iconUrl: { type: DataTypes.STRING, allowNull: true, field: 'icon_url' },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  }, {
    tableName: 'product_master_items',
    timestamps: true
  });

  return ProductMasterItem;
};
