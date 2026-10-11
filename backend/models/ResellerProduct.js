// Product Management > Our Products — a reseller's own catalog of products
// they're set up to sell, one row per product. Optionally linked back to
// the DealerAuthRequest that authorized it (auto-fills Auth Serial No.,
// Product Name, OEM By, and the validity window), but a row can also be
// added standalone for products not yet tied to a formal authorization.
// `catalogFilePath`/`catalogFileName` hold an uploaded catalog document —
// AI extraction of products/specs from it is a future step (needs the same
// local-Ollama infra used elsewhere in this app), not implemented yet.
module.exports = (sequelize, DataTypes) => {
  const ResellerProduct = sequelize.define('ResellerProduct', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    dealerAuthRequestId: { type: DataTypes.INTEGER, allowNull: true, field: 'dealer_auth_request_id' },
    dealerAuthRequestItemId: { type: DataTypes.INTEGER, allowNull: true, field: 'dealer_auth_request_item_id' },
    authSerialNo: { type: DataTypes.STRING, allowNull: true, field: 'auth_serial_no' },
    productName: { type: DataTypes.STRING, allowNull: false, field: 'product_name' },
    decode: { type: DataTypes.STRING, allowNull: true },
    technicalSpecification: { type: DataTypes.TEXT, allowNull: true, field: 'technical_specification' },
    oemBy: { type: DataTypes.STRING, allowNull: true, field: 'oem_by' },
    validFrom: { type: DataTypes.DATEONLY, allowNull: true, field: 'valid_from' },
    validTo: { type: DataTypes.DATEONLY, allowNull: true, field: 'valid_to' },
    catalogFilePath: { type: DataTypes.STRING, allowNull: true, field: 'catalog_file_path' },
    catalogFileName: { type: DataTypes.STRING, allowNull: true, field: 'catalog_file_name' },
  }, {
    tableName: 'reseller_products',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }],
  });

  return ResellerProduct;
};
