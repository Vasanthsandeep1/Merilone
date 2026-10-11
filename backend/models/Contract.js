// Read-only mirror of the tender-automation system's `contracts` table —
// awarded GeM contracts, used for the dashboard's Contract Value / Top
// Sellers / Contract Value Trend cards.
module.exports = (sequelize, DataTypes) => {
  const Contract = sequelize.define('Contract', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    bidNo: { type: DataTypes.STRING, field: 'bid_no' },
    totalValue: { type: DataTypes.STRING, field: 'total_value' },
    sellerName: { type: DataTypes.TEXT, field: 'seller_name' },
    state: { type: DataTypes.STRING },
    contractDate: { type: DataTypes.STRING, field: 'contract_date' },
    orderStatus: { type: DataTypes.STRING, field: 'order_status' },
    dept: { type: DataTypes.ENUM('diagno', 'endo') },
  }, {
    tableName: 'contracts',
    timestamps: false,
  });

  return Contract;
};
