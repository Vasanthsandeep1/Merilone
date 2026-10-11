// Records an OEM choosing a reseller candidate (from Best Reseller
// Selection) as their reseller for a product category + zone/state. A
// lighter-weight record than DealerAuthRequest (which is a real
// reseller-initiated, cross-tenant authorization workflow) — this is just
// the OEM's own note-to-self of who they picked and why, scoped to their
// own userId like every other per-partner table in this app.
module.exports = (sequelize, DataTypes) => {
  const ResellerSelection = sequelize.define('ResellerSelection', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    resellerCandidateId: { type: DataTypes.INTEGER, allowNull: false, field: 'reseller_candidate_id' },
    productCategory: { type: DataTypes.STRING, allowNull: true, field: 'product_category' },
    zone: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.STRING, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'reseller_selections',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }],
  });

  return ResellerSelection;
};
