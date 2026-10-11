// Representation Tracker — this partner's own follow-up on a tender's
// deviation representation letter. The letter itself (and whether it's
// been drafted) lives on the shared TenderProcessingResult row; what
// happens AFTER it's drafted (sent to the buyer, their response) isn't
// tracked anywhere, so it's recorded here per (user, bid) — same scoping
// reasoning as ParticipatedTenderNote / TenderTrackerOverride. Pending and
// Drafted are derived from TenderProcessingResult, never stored.
module.exports = (sequelize, DataTypes) => {
  const RepresentationTracking = sequelize.define('RepresentationTracking', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING(191), allowNull: false, field: 'bid_number' },
    stage: { type: DataTypes.ENUM('submitted', 'accepted', 'partially_accepted', 'rejected'), allowNull: false, defaultValue: 'submitted' },
    submittedAt: { type: DataTypes.DATEONLY, allowNull: true, field: 'submitted_at' },
    respondedAt: { type: DataTypes.DATEONLY, allowNull: true, field: 'responded_at' },
    submittedTo: { type: DataTypes.STRING, allowNull: true, field: 'submitted_to' },
    remarks: { type: DataTypes.TEXT, allowNull: true },
    sentBy: { type: DataTypes.STRING, allowNull: true, field: 'sent_by' },
    sentVia: { type: DataTypes.STRING(64), allowNull: true, field: 'sent_via' },
    receivedBy: { type: DataTypes.STRING, allowNull: true, field: 'received_by' },
    acknowledgementRef: { type: DataTypes.STRING, allowNull: true, field: 'acknowledgement_ref' },
    updatedBy: { type: DataTypes.STRING, allowNull: true, field: 'updated_by' },
    // [{ at, by, stage, note }] — append-only audit trail of every change.
    history: { type: DataTypes.JSON, allowNull: true },
  }, {
    tableName: 'representation_tracking',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'bid_number'] }],
  });
  return RepresentationTracking;
};
