// Per-partner annotations (RA date + remarks) on a "Participated Tender" —
// see tenderController.js's getParticipatedTenders for why membership in
// that list itself is derived (tender_processing_results.result = 'yes'),
// not stored. The original automation site's equivalent
// (participated_tender_notes) was a single global row per bid_no; scoped to
// (user_id, bid_number) here instead since multiple partner tenants share
// this portal and each needs their own notes on the same tender.
module.exports = (sequelize, DataTypes) => {
  const ParticipatedTenderNote = sequelize.define('ParticipatedTenderNote', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    raDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'ra_date' },
    remarks: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'participated_tender_notes',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'bid_number'] }],
  });

  return ParticipatedTenderNote;
};
