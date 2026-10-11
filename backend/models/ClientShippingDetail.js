// A client can have multiple shipping addresses (Add Shipping Detail).
module.exports = (sequelize, DataTypes) => {
  const ClientShippingDetail = sequelize.define('ClientShippingDetail', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    clientId: { type: DataTypes.INTEGER, allowNull: false, field: 'client_id' },
    name: { type: DataTypes.STRING, allowNull: true },
    country: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.STRING, allowNull: true },
    city: { type: DataTypes.STRING, allowNull: true },
    postalCode: { type: DataTypes.STRING, allowNull: true, field: 'postal_code' },
    streetAddress: { type: DataTypes.STRING, allowNull: true, field: 'street_address' },
  }, {
    tableName: 'client_shipping_details',
    timestamps: true,
    underscored: true,
  });

  return ClientShippingDetail;
};
