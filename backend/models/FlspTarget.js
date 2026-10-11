// Target Management > Manage Target: one sales person's (FLSP / sales staff)
// target for one financial year and one division (Diagnostics or Endo
// Surgery), typed in like the budget sheet. `rows` = [{ group, category,
// months: [12 numbers, Apr..Mar, ₹ Lakhs] }]; `total` = their sum (₹ Lakhs).
// The Sales dashboard uses these as the person's target (see
// salesIncentiveController.js).
module.exports = (sequelize, DataTypes) => sequelize.define('FlspTarget', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' }, // org owner
  staffId: { type: DataTypes.INTEGER, allowNull: false, field: 'staff_id' },
  fy: { type: DataTypes.INTEGER, allowNull: false },
  division: { type: DataTypes.ENUM('diagnostics', 'endo'), allowNull: false },
  rsm: { type: DataTypes.STRING, allowNull: true },
  zonalHead: { type: DataTypes.STRING, allowNull: true, field: 'zonal_head' },
  rows: { type: DataTypes.JSON, allowNull: false },
  total: { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: 0 }, // ₹ Lakhs
  updatedByName: { type: DataTypes.STRING, allowNull: true, field: 'updated_by_name' },
  // The person's Sales Target letter (PDF, both divisions), made on every
  // save and kept under backend/data/target-letters/; same values on both rows.
  letterAt: { type: DataTypes.DATE, allowNull: true, field: 'letter_at' },
  letterSentAt: { type: DataTypes.DATE, allowNull: true, field: 'letter_sent_at' },
  letterSentTo: { type: DataTypes.STRING(500), allowNull: true, field: 'letter_sent_to' },
}, {
  tableName: 'flsp_targets',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['staff_id', 'fy', 'division'] }],
});
