// Sales & Invoices > Sales Targets: a sales person's sales target for one
// Indian financial year (fy 2026 = Apr 2026 – Mar 2027), set by the org admin.
// Achievement against it is worked out from the invoices of the clients
// assigned to that sales person (clients.sales_staff_id) — see
// salesIncentiveController.js.
module.exports = (sequelize, DataTypes) => sequelize.define('SalesTarget', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' }, // org owner
  staffId: { type: DataTypes.INTEGER, allowNull: false, field: 'staff_id' },
  fy: { type: DataTypes.INTEGER, allowNull: false },
  targetAmount: { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0, field: 'target_amount' },
}, {
  tableName: 'sales_targets',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['staff_id', 'fy'] }],
});
