// Tracker > LD Tracker — Liquidated Damages settings and outcome for one
// order we must deliver: the LD terms from the tender/contract (rate per
// week or day of delay, maximum cap), the actual delivery date, and what
// happened to the LD (deducted by the buyer, waiver requested, waived).
// One row per order, created the first time the partner edits it; until
// then the order uses the GeM default terms (see ldTrackerController).
// source: 'sales_order' -> quotations.id (docType sales_order)
//         'gem_order'   -> contracts.id (a GeM order in the Order Tracker)
module.exports = (sequelize, DataTypes) => {
  const LdRecord = sequelize.define('LdRecord', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    source: { type: DataTypes.ENUM('sales_order', 'gem_order'), allowNull: false },
    sourceId: { type: DataTypes.INTEGER, allowNull: false, field: 'source_id' },
    ldPercent: { type: DataTypes.DECIMAL(6, 3), allowNull: false, defaultValue: 0.5, field: 'ld_percent' },
    ldBasis: { type: DataTypes.ENUM('week', 'day'), allowNull: false, defaultValue: 'week', field: 'ld_basis' },
    ldCapPercent: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 10, field: 'ld_cap_percent' },
    // Overrides: LD is charged on the value of the delayed supply, which may
    // be less than the whole order; and the contract delivery date.
    baseValue: { type: DataTypes.DECIMAL(14, 2), allowNull: true, field: 'base_value' },
    dueDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'due_date' },
    deliveredAt: { type: DataTypes.DATEONLY, allowNull: true, field: 'delivered_at' },
    status: { type: DataTypes.ENUM('open', 'deducted', 'waiver_requested', 'waived'), allowNull: false, defaultValue: 'open' },
    deductedAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: true, field: 'deducted_amount' },
    remarks: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'ld_records',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'source', 'source_id'] }],
  });
  return LdRecord;
};
