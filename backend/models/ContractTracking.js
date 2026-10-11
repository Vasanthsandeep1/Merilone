// Contract Tracker — this partner's own follow-up on an awarded GeM contract
// (delivery, invoicing, payment). The contract row itself is shared, read-only
// scraped data; what happens after award is tracked here per (user, contract),
// same scoping reasoning as RepresentationTracking / TenderTrackerOverride.
// "Not started" is derived (no row), never stored.
module.exports = (sequelize, DataTypes) => {
  const ContractTracking = sequelize.define('ContractTracking', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    contractId: { type: DataTypes.INTEGER, allowNull: false, field: 'contract_id' },
    followUp: {
      type: DataTypes.ENUM('in_progress', 'dispatched', 'delivered', 'invoiced', 'payment_received', 'issue'),
      allowNull: false, defaultValue: 'in_progress', field: 'follow_up',
    },
    expectedDeliveryDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'expected_delivery_date' },
    deliveredOn: { type: DataTypes.DATEONLY, allowNull: true, field: 'delivered_on' },
    invoiceNo: { type: DataTypes.STRING, allowNull: true, field: 'invoice_no' },
    invoiceDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'invoice_date' },
    paymentReceivedOn: { type: DataTypes.DATEONLY, allowNull: true, field: 'payment_received_on' },
    owner: { type: DataTypes.STRING, allowNull: true },
    remarks: { type: DataTypes.TEXT, allowNull: true },
    updatedBy: { type: DataTypes.STRING, allowNull: true, field: 'updated_by' },
    // [{ at, by, followUp, note }] — append-only audit trail of every change.
    history: { type: DataTypes.JSON, allowNull: true },
  }, {
    tableName: 'contract_tracking',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'contract_id'] }],
  });
  return ContractTracking;
};
