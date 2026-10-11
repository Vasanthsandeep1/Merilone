// Tracker > GP Tracker — a cost price the partner typed in for a product,
// used when no vendor Purchase gives one (and overriding it when it does).
// Products are free-text names on invoices, so they're keyed by the
// normalised name (lower-case, single spaces) — see
// productKey in controllers/gpTrackerController.js.
module.exports = (sequelize, DataTypes) => {
  const GpProductCost = sequelize.define('GpProductCost', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    productKey: { type: DataTypes.STRING, allowNull: false, field: 'product_key' },
    productName: { type: DataTypes.STRING, allowNull: false, field: 'product_name' },
    costPrice: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'cost_price' },
  }, {
    tableName: 'gp_product_costs',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'product_key'] }],
  });
  return GpProductCost;
};
