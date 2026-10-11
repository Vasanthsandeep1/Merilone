// Ported from OLD's "Process Decode" (a rate/pricing-working sheet on the
// Deviation Analysis page that goes through an approval chain) — but
// single-stage here (Zonal Manager only) instead of OLD's Zonal
// Head->Finance, since this app has no Finance role. See
// processDecodeController.js. OLD stored this as generic
// `approval_requests` rows (type='process_decode'); a dedicated table here
// is simpler since there's no other approval-chain feature to share it with.
module.exports = (sequelize, DataTypes) => {
  const ProcessDecodeRequest = sequelize.define('ProcessDecodeRequest', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    bidNo: { type: DataTypes.STRING, allowNull: false, field: 'bid_no' },
    partnerProfileId: { type: DataTypes.INTEGER, allowNull: false, field: 'partner_profile_id' },

    requestedByStaffId: { type: DataTypes.INTEGER, allowNull: true, field: 'requested_by_staff_id' },
    requestedByUserId: { type: DataTypes.INTEGER, allowNull: true, field: 'requested_by_user_id' },
    requesterName: { type: DataTypes.STRING, allowNull: true, field: 'requester_name' },

    reference: { type: DataTypes.STRING, allowNull: true },
    remarks: { type: DataTypes.STRING, allowNull: true },
    // { ratesFor, ref, rows, participation, distributorId, distributorName }
    payload: { type: DataTypes.JSON, allowNull: false },

    status: { type: DataTypes.ENUM('pending', 'approved', 'rejected'), allowNull: false, defaultValue: 'pending' },
    decisionNote: { type: DataTypes.TEXT, allowNull: true, field: 'decision_note' },
    decidedByStaffId: { type: DataTypes.INTEGER, allowNull: true, field: 'decided_by_staff_id' },
    decidedByUserId: { type: DataTypes.INTEGER, allowNull: true, field: 'decided_by_user_id' },
    deciderName: { type: DataTypes.STRING, allowNull: true, field: 'decider_name' },
    decidedAt: { type: DataTypes.DATE, allowNull: true, field: 'decided_at' },

    stageHistory: { type: DataTypes.JSON, allowNull: true, field: 'stage_history' },
  }, {
    tableName: 'process_decode_requests',
    timestamps: true,
    underscored: true,
  });
  return ProcessDecodeRequest;
};
