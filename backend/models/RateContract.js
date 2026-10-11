// Order Management > Rate Contracts — a fixed price this organisation has
// agreed for one of its own products (see PartnerDivisionProduct), for a set
// period (e.g. "Surgical Suture at Rs.5000 for the next 5 years"). Either
// company-wide (clientId null — the default price anyone gets) or specific to
// one client/reseller (clientId set — overrides the default for just them).
// Feeds two things: (1) Rate Contract Tracker (Tracker nav) — expiry alerts,
// email + in-app notifications; (2) auto-filling the rate the moment a
// partner picks this product on a Quotation/Invoice/Sales Order line (see
// exports.getActiveRate in rateContractController.js).
module.exports = (sequelize, DataTypes) => sequelize.define('RateContract', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  productId: { type: DataTypes.INTEGER, allowNull: true, field: 'product_id' },
  productName: { type: DataTypes.STRING(300), allowNull: false, field: 'product_name' },
  division: { type: DataTypes.STRING(30), allowNull: true },
  clientId: { type: DataTypes.INTEGER, allowNull: true, field: 'client_id' },
  clientName: { type: DataTypes.STRING, allowNull: true, field: 'client_name' },
  rate: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  currency: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'INR' },
  contractRef: { type: DataTypes.STRING(150), allowNull: true, field: 'contract_ref' },
  effectiveFrom: { type: DataTypes.DATEONLY, allowNull: false, field: 'effective_from' },
  effectiveTo: { type: DataTypes.DATEONLY, allowNull: false, field: 'effective_to' },
  status: { type: DataTypes.ENUM('active', 'cancelled'), allowNull: false, defaultValue: 'active' },
  remarks: { type: DataTypes.TEXT, allowNull: true },
  // Which expiry-reminder milestones (["90","30","7","0"] days-out) have
  // already been emailed/notified — stops the periodic check re-sending the
  // same alert every time it runs.
  notifiedMilestones: { type: DataTypes.JSON, allowNull: true, field: 'notified_milestones' },
  createdByName: { type: DataTypes.STRING, allowNull: true, field: 'created_by_name' },
  updatedBy: { type: DataTypes.STRING, allowNull: true, field: 'updated_by' },
  history: { type: DataTypes.JSON, allowNull: true },
}, {
  tableName: 'rate_contracts',
  timestamps: true,
  underscored: true,
  indexes: [
    { name: 'idx_rc_user_status', fields: ['user_id', 'status'] },
    { name: 'idx_rc_user_product', fields: ['user_id', 'product_id'] },
    { name: 'idx_rc_effective_to', fields: ['effective_to'] },
  ],
});
