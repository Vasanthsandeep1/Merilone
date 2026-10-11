// Per-partner "which suggested product did this partner pick for this
// tender item" — kept separate from the shared tender_processing_results
// row (same reasoning as TenderPartnerState: that row is shared/global
// scraper output, so one partner's pick can't be written into it without
// leaking across tenants).
module.exports = (sequelize, DataTypes) => {
  const TenderProductSelection = sequelize.define('TenderProductSelection', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    itemKey: { type: DataTypes.STRING, allowNull: false, field: 'item_key' },
    productCode: { type: DataTypes.STRING, allowNull: false, field: 'product_code' },
  }, {
    tableName: 'tender_product_selections',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'bid_number', 'item_key'] }],
  });

  return TenderProductSelection;
};
