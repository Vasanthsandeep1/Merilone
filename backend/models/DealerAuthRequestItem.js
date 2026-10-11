// One product line within a DealerAuthRequest — a request can now cover
// multiple products in a single submission (previously one product per
// request), each with its own condition bullet list. `productCode` is
// free text rather than pulled from a master table: ProductMasterItem has
// no code field, so this is the reseller's own reference code for the row.
// `conditionBullets` is a JSON array of plain strings (one per bullet) —
// the bullet/paragraph editor UX lives entirely on the frontend
// (DealerAuthLetterPage's BulletListEditor); this table just stores the
// resulting list.
module.exports = (sequelize, DataTypes) => {
  const DealerAuthRequestItem = sequelize.define('DealerAuthRequestItem', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    dealerAuthRequestId: { type: DataTypes.INTEGER, allowNull: false, field: 'dealer_auth_request_id' },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
    categoryId: { type: DataTypes.INTEGER, allowNull: true, field: 'category_id' },
    subCategoryId: { type: DataTypes.INTEGER, allowNull: true, field: 'sub_category_id' },
    productId: { type: DataTypes.INTEGER, allowNull: true, field: 'product_id' },
    customProductName: { type: DataTypes.STRING, allowNull: true, field: 'custom_product_name' },
    productCode: { type: DataTypes.STRING, allowNull: true, field: 'product_code' },
    conditionBullets: { type: DataTypes.JSON, allowNull: true, field: 'condition_bullets' },
  }, {
    tableName: 'dealer_auth_request_items',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['dealer_auth_request_id'] }],
  });

  return DealerAuthRequestItem;
};
