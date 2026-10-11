// A partner's own pipeline-status log for a tender (Proceed / Win / Lose /
// Close, with a remark) — mirrors the tender-automation site's Tender
// Status modal, but scoped per (user, bidNumber) for the same reason
// TenderPartnerState is: gem_tenders is shared across every partner on
// this portal, so "our status on this bid" has to live outside it.
module.exports = (sequelize, DataTypes) => {
  const TenderStatusEntry = sequelize.define('TenderStatusEntry', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    status: { type: DataTypes.ENUM('proceed', 'win', 'lose', 'close'), allowNull: false },
    remarks: { type: DataTypes.TEXT, allowNull: true },
    // Which login actually did this — the org owner, or a named staff member
    // (see resolveActor) — distinct from userId, which is always the org
    // owner even for a staff token. Null on rows written before this field
    // existed; shown as "Unassigned" in Active Workspaces.
    actorName: { type: DataTypes.STRING, allowNull: true, field: 'actor_name' },
  }, {
    tableName: 'tender_status_entries',
    timestamps: true,
    underscored: true,
  });

  return TenderStatusEntry;
};
