// A partner's own "Interested" / "Not Relevant" flag on a shared tender row.
// gem_tenders is one global table read by every OEM/Reseller partner on
// this portal — writing straight into gem_tenders.is_interested or
// marked_not_relevant would leak one partner's call onto every other
// partner's view of the same tender. This table keeps that state
// per (user, bidNumber) instead.
module.exports = (sequelize, DataTypes) => {
  const TenderPartnerState = sequelize.define('TenderPartnerState', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    isInterested: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_interested' },
    notRelevant: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'not_relevant' },
    notRelevantReason: { type: DataTypes.TEXT, allowNull: true, field: 'not_relevant_reason' },
  }, {
    tableName: 'tender_partner_states',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'bid_number'] }],
  });

  return TenderPartnerState;
};
